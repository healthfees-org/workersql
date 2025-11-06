package pool_test

import (
"context"
"testing"

"github.com/healthfees-org/workersql/sdk/go/internal/pool"
"github.com/stretchr/testify/assert"
"github.com/stretchr/testify/require"
)

func TestNewPool(t *testing.T) {
t.Run("with defaults", func(t *testing.T) {
p := pool.NewPool(pool.Options{
APIEndpoint: "https://api.workersql.com/v1",
})
defer p.Close()

stats := p.GetStats()
assert.Equal(t, 1, stats["total"])
})
}

func TestAcquireRelease(t *testing.T) {
p := pool.NewPool(pool.Options{
APIEndpoint:    "https://api.workersql.com/v1",
MinConnections: 2,
MaxConnections: 5,
})
defer p.Close()

ctx := context.Background()

t.Run("acquire idle connection", func(t *testing.T) {
conn, err := p.Acquire(ctx)
require.NoError(t, err)
require.NotNil(t, conn)

assert.True(t, conn.InUse)
p.Release(conn)
assert.False(t, conn.InUse)
})
}
