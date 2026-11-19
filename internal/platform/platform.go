package platform

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/atotto/clipboard"
)

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type WTOpen struct {
	Cwd        string
	Title      string
	ConfigDir  string
	ClaudePath string
	SessionID  string
}

func (o WTOpen) validate() error {
	if !filepath.IsAbs(o.Cwd) {
		return fmt.Errorf("cwd must be absolute: %s", o.Cwd)
	}
	if !filepath.IsAbs(o.ConfigDir) {
		return fmt.Errorf("configDir must be absolute: %s", o.ConfigDir)
	}
	if !filepath.IsAbs(o.ClaudePath) {
		return fmt.Errorf("claudePath must be absolute: %s", o.ClaudePath)
	}
	if !uuidRe.MatchString(o.SessionID) {
		return fmt.Errorf("invalid session id: %s", o.SessionID)
	}
	for _, s := range []string{o.Cwd, o.ConfigDir, o.ClaudePath, o.Title} {
		if strings.ContainsAny(s, "'\"\n\r") {
			return fmt.Errorf("value contains forbidden characters: %s", s)
		}
	}
	return nil
}

func BuildWTCommand(o WTOpen) ([]string, error) {
	if err := o.validate(); err != nil {
		return nil, err
	}

	shell := "powershell"
	if p, err := exec.LookPath("pwsh"); err == nil && p != "" {
		shell = "pwsh"
	}

	script := fmt.Sprintf(
		"$env:CLAUDE_CONFIG_DIR='%s'; & '%s' --resume %s",
		o.ConfigDir, o.ClaudePath, o.SessionID,
	)

	if hasWT() {
		return []string{
			"wt", "-w", "0", "nt",
			"-d", o.Cwd,
			"--title", o.Title,
			shell, "-NoLogo", "-NoExit", "-Command", script,
		}, nil
	}

	return []string{
		"cmd", "/c", "start", "",
		shell, "-NoLogo", "-NoExit", "-Command", script,
	}, nil
}

func OpenInWT(o WTOpen) (*exec.Cmd, error) {
	args, err := BuildWTCommand(o)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = o.Cwd
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func hasWT() bool {
	_, err := exec.LookPath("wt")
	return err == nil
}

type EditorResult struct {
	Cmd        []string
	InTerminal bool
}

func EditorCmd(file string, line int, editorEnv, cfgEditor string) EditorResult {
	editor := cfgEditor
	if editor == "" {
		editor = editorEnv
	}
	if editor == "" {
		editor = "nvim"
		if _, err := exec.LookPath("nvim"); err != nil {
			editor = "notepad"
		}
	}

	base := filepath.Base(editor)
	name := strings.TrimSuffix(base, filepath.Ext(base))

	switch strings.ToLower(name) {
	case "nvim", "vim", "vi", "hx", "micro":
		return EditorResult{
			Cmd:        []string{editor, fmt.Sprintf("+%d", line), file},
			InTerminal: true,
		}
	case "code":
		return EditorResult{
			Cmd:        []string{editor, "-g", fmt.Sprintf("%s:%d", file, line)},
			InTerminal: false,
		}
	default:
		return EditorResult{
			Cmd:        []string{editor, file},
			InTerminal: strings.ToLower(name) != "notepad",
		}
	}
}

func Copy(text string) error {
	return clipboard.WriteAll(text)
}

func Bell() {
	fmt.Fprint(os.Stderr, "\a")
}

func Toast(title, body string) error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("toast: unsupported on %s", runtime.GOOS)
	}
	script := `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime]; $xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1); $texts=$xml.GetElementsByTagName('text'); $texts[0].AppendChild($xml.CreateTextNode($env:AC_TOAST_TITLE)) | Out-Null; $texts[1].AppendChild($xml.CreateTextNode($env:AC_TOAST_BODY)) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('ac').Show($t::New($xml))`

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.Env = append(os.Environ(), "AC_TOAST_TITLE="+title, "AC_TOAST_BODY="+body)
	return cmd.Run()
}
