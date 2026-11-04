package domain

import (
	"testing"
	"time"
)

func TestSampleRequiresPaidFence(t *testing.T) {
	o := Order{State: "PENDING_PAYMENT", ChargeState: "PENDING"}
	if Code(o.CanCollect(false)) != "ORDER_NOT_PAID" {
		t.Fatal("unpaid sample accepted")
	}
	o.State = "PAID"
	o.ChargeState = "PAID"
	o.Fence = 1
	o.SettlementState = "SUCCEEDED"
	if e := o.CanCollect(false); e != nil {
		t.Fatal(e)
	}
	o.Specimens = []Specimen{{State: "COLLECTED"}}
	if o.CanCollect(false) == nil {
		t.Fatal("duplicate sample")
	}
	o.Specimens[0].State = "REJECTED"
	if e := o.CanCollect(true); e != nil {
		t.Fatal(e)
	}
}
func TestSettlementTerminalAndFence(t *testing.T) {
	o := Order{State: "PENDING_PAYMENT", Version: 1, SourceRevision: 1, AmountHash: "h", ChargeState: "CREATED", ChargeID: NewID()}
	id := NewID()
	if e := o.Reserve(id, o.ChargeID, 1, "h", 1); e != nil {
		t.Fatal(e)
	}
	if o.State != "SETTLEMENT_LOCKED" || o.Fence != 1 {
		t.Fatal(o)
	}
	if e := o.Decide(id, 0, "SUCCEEDED"); e == nil {
		t.Fatal("stale fence")
	}
	if e := o.Decide(id, 1, "UNKNOWN"); e != nil || o.State != "SETTLEMENT_LOCKED" {
		t.Fatal(o, e)
	}
	if e := o.Decide(id, 1, "SUCCEEDED"); e != nil || o.State != "PAID" {
		t.Fatal(o, e)
	}
	if e := o.Decide(id, 1, "FAILED"); e == nil {
		t.Fatal("terminal reversal")
	}
	_ = time.Now()
}
