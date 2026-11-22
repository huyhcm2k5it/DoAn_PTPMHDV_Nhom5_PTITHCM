//go:build brokerintegration

package redis

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestReadCacheWithRealRedisAndOwnerACL(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL is not configured")
	}
	cache, err := New(url)
	if err != nil {
		t.Fatal(err)
	}
	defer cache.Close()
	ctx := context.Background()
	key := prefix + "integration:" + time.Now().UTC().Format("20060102T150405.000000000")
	if err = cache.Set(ctx, key, []byte(`{"items":[]}`), time.Second); err != nil {
		t.Fatal(err)
	}
	raw, found, err := cache.Get(ctx, key)
	if err != nil || !found || string(raw) != `{"items":[]}` {
		t.Fatal("Redis round trip failed", found, err)
	}
	if err = cache.client.Set(ctx, "outside:owner:namespace", "forbidden", time.Second).Err(); err == nil {
		t.Fatal("Redis ACL allowed a write outside the service namespace")
	}
	if err = cache.Set(ctx, key, raw, 2*time.Minute); err == nil {
		t.Fatal("cache allowed an unbounded TTL")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		_, found, err = cache.Get(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		if !found {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cache did not expire")
		}
		time.Sleep(30 * time.Millisecond)
	}
}
