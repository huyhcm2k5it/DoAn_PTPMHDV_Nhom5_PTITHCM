package redis

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestCircuitBreakerOpensAndAllowsOneProbe(t *testing.T) {
	cache := &Cache{}
	for range maxFailures {
		cache.leave(false, errors.New("connection failed"))
	}
	if _, err := cache.enter(); err == nil {
		t.Fatal("expected open circuit to reject cache operation")
	}

	cache.mu.Lock()
	cache.openTo = time.Now().Add(-time.Second)
	cache.mu.Unlock()
	probe, err := cache.enter()
	if err != nil || !probe {
		t.Fatalf("expected a half-open probe, probe=%v err=%v", probe, err)
	}
	if _, err = cache.enter(); err == nil {
		t.Fatal("expected concurrent half-open probe to be rejected")
	}
	cache.leave(probe, errors.New("still unavailable"))
	if _, err = cache.enter(); err == nil {
		t.Fatal("failed probe must reopen the circuit")
	}
}

func TestReadCacheWithRealRedis(t *testing.T) {
	addr := os.Getenv("TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	cache, err := New(addr, os.Getenv("TEST_REDIS_USERNAME"), os.Getenv("TEST_REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	defer cache.Close()
	ctx := context.Background()
	first, err := cache.Generation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	key := "umc:catalog:v1:" + first + ":integration-test"
	if err = cache.Set(ctx, key, []byte("catalog"), time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	value, found, err := cache.Get(ctx, key)
	if err != nil || !found || string(value) != "catalog" {
		t.Fatalf("cache round trip failed: value=%q found=%v err=%v", value, found, err)
	}
	if err = cache.Set(ctx, "outside:namespace", []byte("forbidden"), time.Now().Add(time.Minute)); err == nil {
		t.Fatal("key outside the Catalog namespace was accepted")
	}
	if os.Getenv("TEST_REDIS_EXPECT_ACL") == "1" {
		if err = cache.client.Set(ctx, "outside:namespace", "forbidden", time.Minute).Err(); err == nil {
			t.Fatal("Redis ACL allowed a key outside the Catalog namespace")
		}
	}
	if err = cache.BumpGeneration(ctx); err != nil {
		t.Fatal(err)
	}
	second, err := cache.Generation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("generation token was not changed")
	}
}
