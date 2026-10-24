package usecase

import (
	"strings"
	"testing"
	"umccare/catalog/internal/application/ports"
)

func TestSearchLengthCountsCharacters(t *testing.T) {
	if !validSearch(ports.SearchQuery{Q: strings.Repeat("ế", 200)}) {
		t.Fatal("200 Vietnamese characters must fit the contract")
	}
	if validSearch(ports.SearchQuery{Q: strings.Repeat("a", 201)}) {
		t.Fatal("201 characters must be rejected")
	}
}
