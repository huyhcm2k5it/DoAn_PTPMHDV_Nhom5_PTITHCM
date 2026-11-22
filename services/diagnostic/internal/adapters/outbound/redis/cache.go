package redis

import (
	"context"
	"errors"
	"strings"
	"time"

	client "github.com/redis/go-redis/v9"
)

const prefix = "umc:diagnostic:v1:"
const timeout = 250 * time.Millisecond

type Cache struct{ client *client.Client }

func New(rawURL string) (*Cache, error) {
	options, err := client.ParseURL(rawURL)
	if err != nil {
		return nil, errors.New("invalid Redis URL")
	}
	options.DialTimeout = timeout
	options.ReadTimeout = timeout
	options.WriteTimeout = timeout
	options.PoolTimeout = timeout
	options.MaxRetries = 0
	options.ContextTimeoutEnabled = true
	options.DisableIndentity = true
	return &Cache{client.NewClient(options)}, nil
}
func (c *Cache) Close() error { return c.client.Close() }
func (c *Cache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	if !strings.HasPrefix(key, prefix) {
		return nil, false, errors.New("cache key outside service namespace")
	}
	call, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	raw, err := c.client.Get(call, key).Bytes()
	if err == client.Nil {
		return nil, false, nil
	}
	return raw, err == nil, err
}
func (c *Cache) Set(ctx context.Context, key string, raw []byte, ttl time.Duration) error {
	if !strings.HasPrefix(key, prefix) || ttl <= 0 || ttl > time.Minute {
		return errors.New("invalid cache key or TTL")
	}
	call, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return c.client.Set(call, key, raw, ttl).Err()
}
