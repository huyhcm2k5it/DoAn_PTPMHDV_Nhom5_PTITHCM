package redis

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

const (
	commandTimeout = 100 * time.Millisecond
	openDuration   = 15 * time.Second
	maxFailures    = 3
	generationKey  = "umc:catalog:v1:generation"
)

type Cache struct {
	client *redisclient.Client
	mu     sync.Mutex
	fails  int
	openTo time.Time
	probe  bool
}

func New(addr, username, password string) (*Cache, error) {
	if addr == "" {
		return nil, errors.New("Redis address is required")
	}
	if username == "" {
		username = "default"
	}
	client := redisclient.NewClient(&redisclient.Options{
		Addr:                  addr,
		Username:              username,
		Password:              password,
		DialTimeout:           commandTimeout,
		ReadTimeout:           commandTimeout,
		WriteTimeout:          commandTimeout,
		PoolTimeout:           commandTimeout,
		MaxRetries:            0,
		ContextTimeoutEnabled: true,
		DisableIndentity:      true,
	})
	return &Cache{client: client}, nil
}

func NewFromURL(rawURL string) (*Cache, error) {
	options, err := redisclient.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	options.DialTimeout = commandTimeout
	options.ReadTimeout = commandTimeout
	options.WriteTimeout = commandTimeout
	options.PoolTimeout = commandTimeout
	options.MaxRetries = 0
	options.ContextTimeoutEnabled = true
	options.DisableIndentity = true
	return &Cache{client: redisclient.NewClient(options)}, nil
}

func (c *Cache) Close() error { return c.client.Close() }

func (c *Cache) Generation(ctx context.Context) (string, error) {
	var generation string
	err := c.command(ctx, func(ctx context.Context) error {
		current, err := c.client.Get(ctx, generationKey).Result()
		if err == redisclient.Nil {
			candidate, tokenErr := newGeneration()
			if tokenErr != nil {
				return tokenErr
			}
			created, setErr := c.client.SetNX(ctx, generationKey, candidate, 0).Result()
			if setErr != nil {
				return setErr
			}
			if created {
				generation = candidate
				return nil
			}
			current, err = c.client.Get(ctx, generationKey).Result()
		}
		if err != nil {
			return err
		}
		generation = current
		return nil
	})
	return generation, err
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	if !cacheKey(key) {
		return nil, false, errors.New("Redis cache key is outside the Catalog namespace")
	}
	var value []byte
	found := false
	err := c.command(ctx, func(ctx context.Context) error {
		result, err := c.client.Get(ctx, key).Bytes()
		if err == redisclient.Nil {
			return nil
		}
		if err != nil {
			return err
		}
		value, found = result, true
		return nil
	})
	return value, found, err
}

func (c *Cache) Set(ctx context.Context, key string, value []byte, expiresAt time.Time) error {
	if !cacheKey(key) || !expiresAt.After(time.Now()) {
		return errors.New("invalid Redis cache key or TTL")
	}
	return c.command(ctx, func(ctx context.Context) error {
		return c.client.Do(ctx, "SET", key, value, "PXAT", expiresAt.UnixMilli()).Err()
	})
}

func cacheKey(key string) bool {
	return strings.HasPrefix(key, "umc:catalog:v1:") && key != generationKey
}

func (c *Cache) BumpGeneration(ctx context.Context) error {
	return c.command(ctx, func(ctx context.Context) error {
		token, err := newGeneration()
		if err != nil {
			return err
		}
		return c.client.Set(ctx, generationKey, token, 0).Err()
	})
}

func newGeneration() (string, error) {
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(token[:]), nil
}

func (c *Cache) command(parent context.Context, run func(context.Context) error) error {
	probe, err := c.enter()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, commandTimeout)
	defer cancel()
	err = run(ctx)
	if parent.Err() == nil {
		c.leave(probe, err)
	} else if probe {
		c.mu.Lock()
		c.probe = false
		c.mu.Unlock()
	}
	return err
}

func (c *Cache) enter() (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.openTo.IsZero() {
		return false, nil
	}
	now := time.Now()
	if now.Before(c.openTo) {
		return false, errors.New("Redis cache circuit is open")
	}
	if c.probe {
		return false, errors.New("Redis cache circuit probe is in progress")
	}
	c.probe = true
	return true, nil
}

func (c *Cache) leave(probe bool, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !probe && !c.openTo.IsZero() {
		return
	}
	if err == nil {
		c.fails = 0
		c.openTo = time.Time{}
		c.probe = false
		return
	}
	c.fails++
	c.probe = false
	if probe || c.fails >= maxFailures {
		c.openTo = time.Now().Add(openDuration)
	}
}
