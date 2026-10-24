package domain

import (
	"testing"
	"time"
)

func TestRejectSubMicrosecondPriceTimestamps(t *testing.T) {
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	for _, which := range []string{"from", "to"} {
		t.Run(which, func(t *testing.T) {
			end := now.Add(2 * time.Hour)
			p := PriceInput{ItemType: "EXAM", ItemID: NewID(), AmountVND: 0, EffectiveFrom: now.Add(time.Hour), EffectiveTo: &end}
			if which == "from" {
				p.EffectiveFrom = p.EffectiveFrom.Add(time.Nanosecond)
			} else {
				x := end.Add(time.Nanosecond)
				p.EffectiveTo = &x
			}
			if Code(p.Validate(now)) != "VALIDATION_ERROR" {
				t.Fatal("unsupported timestamp precision must fail as 400 before persistence")
			}
		})
	}
}
