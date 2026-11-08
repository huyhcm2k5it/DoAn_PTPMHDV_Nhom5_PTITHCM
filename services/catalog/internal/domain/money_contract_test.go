package domain

import (
	"testing"
	"time"
)

func TestPriceRejectsUnsafeJSONInteger(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	p := PriceInput{ItemType: "LAB", ItemID: NewID(), AmountVND: 9007199254740992, EffectiveFrom: now.Add(time.Hour)}
	if err := p.Validate(now); err == nil {
		t.Fatal("price exceeds canonical JSON safe integer bound")
	}
}
