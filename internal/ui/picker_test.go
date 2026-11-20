package ui

import (
	"strings"
	"testing"

	"github.com/longpl-1902/claude-ui/internal/core"
)

func TestPicker_SwitchAccountSticks(t *testing.T) {
	be := newFakeBackend()
	h := newHarness(t, be, Options{ShowPicker: true}, 100, 30)
	if h.m.screen != ScreenPicker {
		t.Fatalf("screen = %v, want picker", h.m.screen)
	}
	h.mustContain("Select account")

	h.press("j", "enter")

	acts := be.recorded(core.ActionSwitchAccount)
	if len(acts) != 1 || acts[0].ID != "beta" || acts[0].Text != "" {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
	// Regression: the refresh after the round trip re-reads the backend and
	// must show the new account, not the old one.
	if got := be.Account().ID; got != "beta" {
		t.Fatalf("backend account = %q", got)
	}
	if h.m.acct.ID != "beta" {
		t.Fatalf("model account = %q after refresh", h.m.acct.ID)
	}
	if h.m.screen != ScreenMain || h.m.mode != ModeInsert {
		t.Fatalf("screen=%v mode=%v, want main/INSERT", h.m.screen, h.m.mode)
	}
	h.mustContain("beta")
	h.mustContain("INSERT")
}

func TestPicker_NotShownWithoutFlag(t *testing.T) {
	h := newHarness(t, newFakeBackend(), Options{ShowPicker: false}, 100, 30)
	if h.m.screen != ScreenMain || h.m.mode != ModeInsert {
		t.Fatalf("screen=%v mode=%v, want main/INSERT", h.m.screen, h.m.mode)
	}
	if s := h.plain(); strings.Contains(s, "Select account") {
		t.Fatalf("picker rendered:\n%s", s)
	}
}

func TestPicker_SingleAccountSkipsPicker(t *testing.T) {
	be := newFakeBackend()
	be.accts = be.accts[:1]
	h := newHarness(t, be, Options{ShowPicker: true}, 100, 30)
	if h.m.screen != ScreenMain {
		t.Fatalf("screen = %v, want main", h.m.screen)
	}
}

func TestPicker_AlwaysUseAndSignIn(t *testing.T) {
	be := newFakeBackend()
	h := newHarness(t, be, Options{ShowPicker: true}, 100, 30)
	h.press("u")
	acts := be.recorded(core.ActionSwitchAccount)
	if len(acts) != 1 || acts[0].ID != "acme" || acts[0].Text != "always" {
		t.Fatalf("u: actions = %s", debugActions(be.actions))
	}
	if h.m.screen != ScreenMain {
		t.Fatalf("u should leave the picker")
	}

	be2 := newFakeBackend()
	h2 := newHarness(t, be2, Options{ShowPicker: true}, 100, 30)
	h2.press("s")
	acts = be2.recorded(core.ActionSignIn)
	if len(acts) != 1 || acts[0].ID != "acme" {
		t.Fatalf("s: actions = %s", debugActions(be2.actions))
	}
	if h2.m.screen != ScreenPicker {
		t.Fatalf("sign in must keep the picker open")
	}
}

func TestPicker_AlwaysUseTogglesToNever(t *testing.T) {
	be := newFakeBackend()
	be.accts[0].AlwaysUse = true
	h := newHarness(t, be, Options{ShowPicker: true}, 100, 30)
	h.mustContain("(always)")
	h.press("u")
	acts := be.recorded(core.ActionSwitchAccount)
	if len(acts) != 1 || acts[0].Text != "never" {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
}

func TestPicker_NotSignedInRow(t *testing.T) {
	be := newFakeBackend()
	be.accts[1].SignedIn = false
	be.accts[1].Email = ""
	h := newHarness(t, be, Options{ShowPicker: true}, 100, 30)
	h.mustContain("not signed in")

	// Enter on a not-signed-in row signs in instead of switching.
	h.press("j", "enter")
	if len(be.recorded(core.ActionSignIn)) != 1 || len(be.recorded(core.ActionSwitchAccount)) != 0 {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
}

func TestPicker_CtrlCQuits(t *testing.T) {
	h := newHarness(t, newFakeBackend(), Options{ShowPicker: true}, 100, 30)
	h.press("ctrl+c")
	if !h.quit {
		t.Fatal("ctrl+c in the start-up picker did not quit")
	}
	if len(h.be.actions) != 0 {
		t.Fatalf("unexpected actions: %s", debugActions(h.be.actions))
	}
}

func TestPicker_CtrlCFromAccountCommandReturns(t *testing.T) {
	h := newHarness(t, newFakeBackend(), Options{}, 100, 30)
	h.press("esc", ":").typeText("account").press("enter")
	if h.m.screen != ScreenPicker {
		t.Fatalf("screen = %v, want picker", h.m.screen)
	}
	h.press("ctrl+c")
	if h.quit {
		t.Fatal(":account picker must go back, not quit")
	}
	if h.m.screen != ScreenMain {
		t.Fatalf("screen = %v, want main", h.m.screen)
	}
}
