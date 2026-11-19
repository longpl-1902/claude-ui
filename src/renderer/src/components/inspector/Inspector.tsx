import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { formatElapsed, formatTokens } from "@shared/format";
import { formatAgentMessage } from "@shared/agentMessage";
import {
  selectSelectedAgentOrNull,
  useAgentStatusInfo,
  useConsoleStore,
  type InspectorTab,
} from "../../store/useConsoleStore";
import { selectControlForSession, useControlStore } from "../../store/useControlStore";
import {
  rendererPlatform,
  selectWorktreeViews,
  useWorkspaceStore,
} from "../../store/useWorkspaceStore";
import type { Agent } from "@shared/types";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { StatusPill } from "../ui/StatusPill";
import { useViewedAccount } from "../team/TeamHeader";
import { ActivityTab } from "./ActivityTab";
import { FilesTab } from "./FilesTab";
import { CopyButton } from "../chat/CopyButton";
import { MessagesTab } from "./MessagesTab";
import "./inspector.css";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
  { id: "messages", label: "Messages" },
];
const tabId = (t: InspectorTab): string => `insp-tab-${t}`;
const PANEL_ID = "insp-panel";

export interface InspectorLayoutProps {
  /** Height (px) of the top section (header, stats, task, actions); the tabs fill the rest. */
  topHeight?: number;
  /** Rendered between the top section and the tabs (the resize handle, owned by TeamView). */
  splitter?: ReactNode;
}

export const INSPECTOR_TOP_ID = "ac-insp-top";

export const EXTERNAL_MESSAGE_TITLE =
  "Runs in VS Code / another terminal - Claude Code has no API to send it messages from outside.";

export function entrypointLabel(e?: string): string {
  if (!e) return "Unknown";
  const l = e.toLowerCase();
  if (l.includes("vscode")) return "VS Code extension";
  if (l === "cli") return "Terminal (claude CLI)";
  if (l === "sdk-cli") return "Agent SDK";
  return e;
}

export function Inspector({ topHeight, splitter }: InspectorLayoutProps = {}): JSX.Element {
  const agent = useConsoleStore(selectSelectedAgentOrNull);
  const agentCount = useConsoleStore((s) => s.team.agents.length);
  if (!agent) {
    return (
      <aside className="insp" aria-label="Agent inspector">
        <h2 className="insp__name">Inspector</h2>
        <span className="insp-empty">
          {agentCount === 0 ? "No agents yet" : "Select an agent"}
        </span>
      </aside>
    );
  }
  return <InspectorBody agent={agent} topHeight={topHeight} splitter={splitter} />;
}

function InspectorBody({
  agent,
  topHeight,
  splitter,
}: { agent: Agent } & InspectorLayoutProps): JSX.Element {
  const info = useAgentStatusInfo(agent.id);
  const team = useConsoleStore((s) => s.team);
  const live = team.source !== "demo";
  const tab = useConsoleStore((s) => s.inspectorTab);
  const setInspectorTab = useConsoleStore((s) => s.setInspectorTab);
  const setConsoleDraft = useConsoleStore((s) => s.setConsoleDraft);
  const summary = useConsoleStore((s) => s.sessions.find((x) => x.sessionId === team.sessionId));
  const account = useViewedAccount();
  const workspace = useWorkspaceStore((s) => s.workspace);

  const control = useControlStore(selectControlForSession(team.sessionId));
  const send = useControlStore((s) => s.send);
  const interrupt = useControlStore((s) => s.interrupt);
  const stop = useControlStore((s) => s.stop);

  const controlled = live && !!control && control.state !== "exited";
  const busy = controlled && control.state === "busy";
  const isLead = agent.runtime?.kind === "lead" || agent.id === "lead";
  const registryPid = summary?.registryPid;
  const externalLive = live && !controlled && summary?.live === true;

  const views = selectWorktreeViews(workspace, team.agents, rendererPlatform());
  const worktreePath =
    views.worktrees.find((w) => w.agentIds.includes(agent.id))?.path ??
    team.worktrees.find((w) => w.branch === agent.worktree)?.path ??
    (agent.cwd || undefined);

  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState("");
  const [confirm, setConfirm] = useState<"stop-session" | "stop-process" | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [working, setWorking] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setInspectorTab(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  const messageAgent = (): void => {
    if (live) {
      setComposerOpen((o) => !o);
      return;
    }
    setConsoleDraft(`@${agent.name} `);
    document.getElementById("ac-prompt")?.focus();
  };

  const submitMessage = async (): Promise<void> => {
    const body = text.trim();
    if (!control || body === "") return;
    setSendError("");
    const r = await send(control.id, isLead ? body : formatAgentMessage(agent.name, body));
    if (r.ok) {
      setText("");
      setComposerOpen(false);
    } else setSendError(`Could not send (${r.reason ?? "failed"}).`);
  };

  const pause = (): void => {
    if (!live) {
      void window.api?.agent.pause(agent.id);
      return;
    }
    if (control && busy) void interrupt(control.id);
  };

  const doStopSession = async (): Promise<void> => {
    if (!control) return;
    setWorking(true);
    try {
      const r = await stop(control.id);
      if (r.ok) setConfirm(null);
      else setConfirmError(`Could not stop the session (${r.reason ?? "failed"}).`);
    } finally {
      setWorking(false);
    }
  };

  const doKillExternal = async (): Promise<void> => {
    if (!summary || registryPid === undefined) return;
    setWorking(true);
    try {
      const r = await window.api?.session.killExternal({
        accountId: summary.accountId,
        sessionId: summary.sessionId,
        pid: registryPid,
      });
      if (r?.ok) setConfirm(null);
      else setConfirmError(`Could not stop the process (${r?.reason ?? "unavailable"}).`);
    } catch (e) {
      setConfirmError(`Could not stop the process (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setWorking(false);
    }
  };

  const stopAction = (): void => {
    if (!live) {
      void window.api?.agent.stop(agent.id);
      return;
    }
    setConfirmError("");
    if (controlled) {
      if (busy) setConfirm("stop-session");
      else if (control) void stop(control.id);
      return;
    }
    if (externalLive && registryPid !== undefined) setConfirm("stop-process");
  };

  // ---- action matrix
  const messageDisabled = live && !controlled;
  const messageTitle = !live ? undefined : controlled ? undefined : EXTERNAL_MESSAGE_TITLE;
  const pauseDisabled = live && !busy;
  const pauseTitle = !live
    ? undefined
    : busy
      ? isLead
        ? "Interrupts the current turn"
        : "Interrupts the whole current turn"
      : controlled
        ? "Nothing is running right now (idle)"
        : "Runs outside this app - it cannot be paused from here";
  const stopLabel = live && !controlled ? "Stop process…" : "Stop";
  const stopDisabled = live && !controlled && !(externalLive && registryPid !== undefined);
  const stopTitle = !live
    ? undefined
    : controlled
      ? "Ends the controlled session (the whole team, not only this agent)"
      : externalLive
        ? registryPid === undefined
          ? "Process id unknown"
          : "Ends this Claude Code process (asks first)"
        : "This session is not running";

  const stats = [
    ["Elapsed", formatElapsed(agent.elapsedSec)],
    ["Tokens", formatTokens(agent.tokens)],
    ["Tool calls", String(agent.toolCalls)],
  ];

  const projectName = summary?.project?.name ?? team.repo;
  const sessionTitle = summary?.title ?? team.title ?? team.teamName;

  return (
    <aside className="insp" aria-label="Agent inspector">
      <div
        id={INSPECTOR_TOP_ID}
        className="insp__top"
        style={topHeight === undefined ? undefined : { height: topHeight }}
      >
      <div className="insp__head">
        <Avatar initials={agent.initials} color={agent.avatarColor} size={40} />
        <div className="insp__who">
          <span className="insp__name">{agent.name}</span>
          <span className="insp__sub">
            {[agent.role, agent.model && !agent.role.includes(agent.model) ? agent.model : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <span title={info.reason}>
          <StatusPill status={info.status} />
        </span>
      </div>
      {live && agent.cwd && (
        <div className="insp__sub" style={{ fontFamily: "var(--ac-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={agent.cwd}>
          {agent.cwd}
        </div>
      )}

      <div className="insp__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="insp__stat">
            <div className="insp__stat-label">{label}</div>
            <div className="insp__stat-value">{value}</div>
          </div>
        ))}
      </div>

      <div className="insp__task">
        <span className="insp__task-label">Assigned task</span>
        <span className="insp__task-title">{agent.taskTitle}</span>
        <span className="insp__task-wt">⎇ {live ? agent.worktree || "—" : agent.worktree}</span>
      </div>
      <div className="insp__actions">
        <Button
          size="lg"
          disabled={messageDisabled}
          title={messageTitle}
          aria-expanded={live && controlled ? composerOpen : undefined}
          onClick={messageAgent}
        >
          Message agent
        </Button>
        <Button
          size="lg"
          disabled={!worktreePath}
          title={worktreePath ? undefined : "No worktree path for this agent"}
          onClick={() => {
            if (worktreePath)
              void window.api?.worktree.openInEditor(worktreePath);
          }}
        >
          Open worktree
        </Button>
        <Button size="lg" disabled={pauseDisabled} title={pauseTitle} onClick={pause}>
          Pause
        </Button>
        <Button
          size="lg"
          variant="danger"
          disabled={stopDisabled}
          title={stopTitle}
          onClick={stopAction}
        >
          {stopLabel}
        </Button>
      </div>
      {live && controlled && composerOpen && (
        <div className="insp__composer">
          <textarea
            aria-label={`Message to ${agent.name}`}
            rows={3}
            value={text}
            placeholder={isLead ? "Message the lead" : `Message ${agent.name} (sent through the lead)`}
            onChange={(e) => setText(e.target.value)}
          />
          {sendError && (
            <span className="insp__composer-error" role="alert">
              {sendError}
            </span>
          )}
          <div className="insp__composer-row">
            <Button size="sm" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={text.trim() === ""} onClick={() => void submitMessage()}>
              Send
            </Button>
          </div>
        </div>
      )}
      </div>
      {splitter}
      <div className="insp__bottom">
      <div
        role="tablist"
        aria-label="Agent details"
        className="insp__tabs"
        onKeyDown={onKeyDown}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={tab === t.id}
            aria-controls={PANEL_ID}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "insp__tab insp__tab--on" : "insp__tab"}
            onClick={() => setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)}>
        {tab === "activity" && <ActivityTab items={agent.activity} />}
        {tab === "files" && <FilesTab files={agent.files} />}
        {tab === "messages" && <MessagesTab messages={agent.messages} />}
      </div>
      </div>

      <Dialog
        open={confirm === "stop-process"}
        title="Stop this process?"
        onClose={() => setConfirm(null)}
        initialFocus={() => document.getElementById("insp-confirm-cancel")}
        footer={
          <>
            <Button onClick={() => setConfirm(null)} id="insp-confirm-cancel">
              Cancel
            </Button>
            <Button variant="danger" disabled={working} onClick={() => void doKillExternal()}>
              Stop process
            </Button>
          </>
        }
      >
        <dl className="insp-confirm">
          <dt>Project</dt>
          <dd>{projectName}</dd>
          <dt>Session</dt>
          <dd>{sessionTitle}</dd>
          {summary?.sessionId && (
            <>
              <dt>Session id</dt>
              <dd>
                {summary.sessionId}
                <CopyButton className="ac-copy--always" text={summary.sessionId} label="session id" />
              </dd>
            </>
          )}
          <dt>Account</dt>
          <dd>{account?.name ?? "Default account"}</dd>
          <dt>Started from</dt>
          <dd>{entrypointLabel(summary?.entrypoint)}</dd>
          <dt>Process id</dt>
          <dd>
            {registryPid}
            {registryPid != null && (
              <CopyButton className="ac-copy--always" text={String(registryPid)} label="process id" />
            )}
          </dd>
          <dt>Folder</dt>
          <dd title={summary?.cwd ?? team.cwd}>{summary?.cwd ?? team.cwd ?? "unknown"}</dd>
        </dl>
        <p>
          Ends this Claude Code process and its tool processes. The transcript is kept; the turn in progress is lost.
        </p>
        {confirmError && (
          <p className="insp__composer-error" role="alert">
            {confirmError}
          </p>
        )}
      </Dialog>

      <Dialog
        open={confirm === "stop-session"}
        title="Stop this session?"
        onClose={() => setConfirm(null)}
        initialFocus={() => document.getElementById("insp-confirm-cancel")}
        footer={
          <>
            <Button id="insp-confirm-cancel" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" disabled={working} onClick={() => void doStopSession()}>
              Stop session
            </Button>
          </>
        }
      >
        <p>
          {projectName} / {sessionTitle} is working right now. Stopping ends the whole controlled session; the turn in
          progress is lost and the transcript is kept.
        </p>
        {confirmError && (
          <p className="insp__composer-error" role="alert">
            {confirmError}
          </p>
        )}
      </Dialog>
    </aside>
  );
}
