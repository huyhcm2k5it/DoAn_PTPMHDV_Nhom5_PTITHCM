package domain

import (
	"testing"
	"time"
)

func TestPriceValidation(t *testing.T) {
	now := time.Date(2026, 10, 22, 1, 0, 0, 0, time.UTC)
	valid := PriceInput{ItemType: "EXAM", ItemID: "00000000-0000-4000-8000-000000000001", AmountVND: 100000, EffectiveFrom: now.Add(5 * time.Minute)}
	for _, tc := range []struct {
		name   string
		change func(*PriceInput)
		want   string
	}{
		{"valid", func(*PriceInput) {}, ""},
		{"negative amount", func(p *PriceInput) { p.AmountVND = -1 }, "VALIDATION_ERROR"},
		{"too soon", func(p *PriceInput) { p.EffectiveFrom = now.Add(4 * time.Minute) }, "VALIDATION_ERROR"},
		{"invalid item", func(p *PriceInput) { p.ItemType = "OTHER" }, "VALIDATION_ERROR"},
		{"invalid uuid", func(p *PriceInput) { p.ItemID = "not-an-id" }, "VALIDATION_ERROR"},
		{"empty interval", func(p *PriceInput) { x := p.EffectiveFrom; p.EffectiveTo = &x }, "VALIDATION_ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := valid
			tc.change(&p)
			err := p.Validate(now)
			if Code(err) != tc.want {
				t.Fatalf("code=%s want %s (%v)", Code(err), tc.want, err)
			}
		})
	}
}

func TestIntervalsAreHalfOpen(t *testing.T) {
	start := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	if Overlaps(start, &end, end, nil) {
		t.Fatal("adjacent price periods overlap")
	}
	if !Overlaps(start, nil, end, nil) {
		t.Fatal("open-ended price must overlap later price")
	}
	if !Overlaps(start, &end, start.Add(time.Minute), &end) {
		t.Fatal("intersecting periods must overlap")
	}
}
