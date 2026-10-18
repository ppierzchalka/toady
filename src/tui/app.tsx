import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { reducer, type Action, type SessionState } from './state.js';
import { decideLayout, fitCapped, headerRows, marginRows, supportsTruecolor, truncateCells, visibleWindow, wrapLines } from './layout.js';
import { loadArtwork, type Artwork } from './art.js';
import { cancelDiscovery, discoverModels, type DiscoveryResult } from './discovery.js';
import { editText, moveFocus, editActionIds, itemRows, menuGeometry, allocateErrors, MenuList, EDIT_CANCEL_ID, EDIT_COMMIT_ID, EDIT_DETAILS_ID, type MenuItem } from './components/controls.js';
import { Avatar, Footer, Header, Message, QuitDialog } from './components/chrome.js';
import { palette } from './theme.js';
import type { InstallAllResult } from '../installer/installAll.js';
import { DirectoryScreen, activateDirectory, directoryFixedRows, directoryFocusIds, directoryItems, directoryShortcuts, isUseTarget, localTargetRefresh, targetEntries, validateTargetDir, type TargetEntry, type TargetRefreshLoader } from './screens/directory.js';
import {
  AgentsScreen,
  activateAgentsList,
  activateEditor,
  agentsFixedRows,
  agentsListFocusIds,
  agentsListItems,
  commitEditorDraft,
  commitSearch,
  editorFocusIds,
  editorItems,
  editorRegionCount,
  agentsShortcuts,
  toggleEditor,
} from './screens/agents.js';
import {
  InstructionsScreen,
  activateInstructions,
  browserEntries,
  commitBrowserFile,
  commitRulesPath,
  instructionsBrowserItems,
  instructionsFixedRows,
  instructionsFocusIds,
  instructionsItems,
  instructionsShortcuts,
} from './screens/instructions.js';
import { ReviewScreen, activateReview, reviewFixedRows, reviewFocusIds, reviewItems, reviewShortcuts } from './screens/review.js';

let cachedArt: Artwork | null | undefined;
function artwork(): Artwork | null {
  if (cachedArt === undefined) {
    try {
      cachedArt = loadArtwork();
    } catch {
      cachedArt = null;
    }
  }
  return cachedArt;
}

export type AppResult =
  | { type: 'install'; state: SessionState; installResult: InstallAllResult }
  | { type: 'install-error'; state: SessionState; error: string }
  | { type: 'quit'; state: SessionState; interrupted?: boolean };

/**
 * Explicit edit-action resolution for the actions region. Anything
 * unrecognized (including a focus id whose row vanished) resolves to null
 * and must stay a no-op — an invalid focus must never silently commit.
 */
export function resolveEditAction(focusId: string): 'commit' | 'cancel' | 'details' | null {
  if (focusId === EDIT_COMMIT_ID) return 'commit';
  if (focusId === EDIT_CANCEL_ID) return 'cancel';
  if (focusId === EDIT_DETAILS_ID) return 'details';
  return null;
}

/**
 * The shell stays mounted through validation and writes (truthful phase
 * labels, no fabricated progress). Only after the install settles does the
 * app exit, so terminal restoration always precedes durable console output.
 */
export type InstallHandler = (state: SessionState) => Promise<InstallAllResult> | InstallAllResult;

export function InstallerApp(options: {
  initial: SessionState;
  onDone: (result: AppResult) => void;
  discover?: () => Promise<DiscoveryResult>;
  onInstall?: InstallHandler;
  /** Synchronous read-only refresh for target/harness changes (no writes).
   * Defaults to a local saved-config/editor-status read that keeps the
   * session conflicts; the CLI injects full conflict refresh. */
  loadRefresh?: TargetRefreshLoader;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, options.initial);
  const { columns, rows } = useWindowSize();
  const { exit } = useApp();
  const done = useRef(false);
  const onDoneRef = useRef(options.onDone);
  onDoneRef.current = options.onDone;
  const onInstallRef = useRef(options.onInstall);
  onInstallRef.current = options.onInstall;
  const stateRef = useRef(state);
  stateRef.current = state;
  const writingRef = useRef(false);
  const pendingQuitRef = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'validating' | 'writing'>('idle');

  const finish = (result: AppResult) => {
    if (done.current) return;
    done.current = true;
    // Actual cleanup: listeners removed exactly once, probes cancelled.
    signalsOff.current?.();
    cancelDiscovery();
    onDoneRef.current(result);
    exit();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Own catchable signals for the whole mounted life, including the write
  // window. Persistent handlers (not one-shot): a second signal while a
  // write settles keeps the partial-write warning instead of killing the
  // process. Removal happens exactly once at actual cleanup; the mount
  // effect below also removes on unmount.
  // Truthful limitation: a fully synchronous writer cannot interleave JS
  // signal delivery — the handler runs right after it returns, while the
  // outcome is still settled through pendingQuit. No unsafe promises.
  const signalsOff = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onSignal = () => {
      if (done.current) return;
      const current = stateRef.current;
      if (writingRef.current || current.installRequested) {
        pendingQuitRef.current = true;
        dispatch({ type: 'NOTICE', notice: 'Signal received — finishing the current write, then quitting. The target may be partially written.' });
        return;
      }
      if (current.quitDialog) {
        finishRef.current({ type: 'quit', state: current });
        return;
      }
      dispatch({ type: 'REQUEST_QUIT' });
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    signalsOff.current = () => {
      if (!signalsOff.current) return;
      signalsOff.current = null;
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };
    return () => {
      signalsOff.current?.();
      cancelDiscovery();
    };
  }, []);

  useEffect(() => {
    // A presettled catalog (tests, restored sessions) is never re-detected.
    if (options.initial.discovery.status !== 'loading') return;
    let live = true;
    const detect = options.discover ?? discoverModels;
    detect()
      .then((result) => {
        if (live) dispatch({ type: 'SET_DISCOVERY', discovery: { status: 'ready', models: result.models, detail: result.detail } });
      })
      .catch(() => {
        if (live) {
          dispatch({
            type: 'SET_DISCOVERY',
            discovery: { status: 'unavailable', models: [], detail: 'Provider detection failed — inherit the harness model or type a model ID.' },
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const installStarted = useRef(false);
  useEffect(() => {
    if (!state.installRequested || installStarted.current) return;
    installStarted.current = true;
    let unmounted = false;
    const settle = async () => {
      const handler = onInstallRef.current;
      if (!handler) {
        if (!unmounted) finishRef.current({ type: 'install-error', state: stateRef.current, error: 'Installer misconfigured: no install handler. No files written.' });
        return;
      }
      setPhase('validating');
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (unmounted) return;
      setPhase('writing');
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (unmounted) return;
      writingRef.current = true;
      try {
        const installResult = await handler(stateRef.current);
        writingRef.current = false;
        if (unmounted) return;
        if (pendingQuitRef.current) finishRef.current({ type: 'quit', state: stateRef.current, interrupted: true });
        else finishRef.current({ type: 'install', state: stateRef.current, installResult });
      } catch (error) {
        writingRef.current = false;
        if (unmounted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (pendingQuitRef.current) finishRef.current({ type: 'quit', state: stateRef.current, interrupted: true });
        else finishRef.current({ type: 'install-error', state: stateRef.current, error: message });
      }
    };
    void settle();
    return () => {
      unmounted = true;
    };
  }, [state.installRequested]);

  const uxNoted = useRef(false);
  useEffect(() => {
    if (uxNoted.current || state.discovery.status !== 'ready' || state.harness !== 'opencode') return;
    if (!state.config.ux?.model && !state.notice && !state.error) {
      uxNoted.current = true;
      dispatch({
        type: 'NOTICE',
        notice: 'No recommended Sol model is available for UX. An unset UX model inherits the current model; select a suitable model explicitly before running design work.',
      });
    }
  }, [state]);

  const art = useMemo(() => artwork(), []);
  const truecolor = useMemo(() => supportsTruecolor(process.env), []);
  const layout = decideLayout({ columns, rows, artCols: art?.cols ?? 40, artRows: art?.rows ?? 20 });
  const compact = layout.density === 'compact';
  // Advisory lines (provider detail, UX default note, detection banner) only
  // render when the viewport can afford them; actions always fit first.
  const roomy = rows > 10;
  // At the minimum band labels alone carry the meaning; hints return above it.
  const hintMode = rows <= 8 ? 'none' : compact ? 'focused' : 'all';
  // Minimum band: variable content scrolls inside the list; info rows and
  // short labels replace advisory blocks so nothing pushes actions out.
  const minimal = rows <= 8;
  const width = Math.max(20, columns - 4);
  // F05: list content measures the ACTUAL menu column, not the whole
  // terminal — beside the avatar that is width minus art and gap.
  const menuWidth = layout.avatar && art ? Math.max(20, width - art.cols - 3) : width;
  const entries = useMemo(
    () => {
      if (state.step !== 'instructions' || !state.rulesBrowser.open) return { entries: [], fsError: null as string | null };
      const loaded = browserEntries(state.rulesBrowser.dir, state.rulesBrowser.showHidden);
      return { entries: loaded.entries, fsError: state.rulesBrowser.error ?? loaded.error };
    },
    [state.step, state.rulesBrowser.open, state.rulesBrowser.dir, state.rulesBrowser.showHidden, state.rulesBrowser.error],
  );
  const entryList = entries.entries;
  const targetList = useMemo(
    () => {
      if (state.step !== 'directory' || !state.targetBrowser.open) return { entries: [] as TargetEntry[], fsError: null as string | null };
      const loaded = targetEntries(state.targetBrowser.dir, state.targetBrowser.showHidden);
      return { entries: loaded.entries, fsError: state.targetBrowser.error ?? loaded.error };
    },
    [state.step, state.targetBrowser.open, state.targetBrowser.dir, state.targetBrowser.showHidden, state.targetBrowser.error],
  );
  const targetEntryList = targetList.entries;
  const targetFsError = targetList.fsError;

  // (Viewport budgeting is computed below, after shortcuts, so the
  // footer's measured rows join the chrome account.)



  const regionCount = state.draftFor ? 2 : state.step === 'agents' && state.agentDetail ? editorRegionCount(state) : 1;

  /** Screen menu items for the current view (edit-action rows excluded). */
  const currentItems = (current: SessionState): MenuItem[] => {
    if (current.step === 'directory') {
      if (!current.targetBrowser.open) return directoryItems(current, [], minimal);
      const loaded = targetEntries(current.targetBrowser.dir, current.targetBrowser.showHidden);
      return directoryItems(current, loaded.entries, minimal);
    }
    if (current.step === 'review') return reviewItems(current);
    if (current.step === 'instructions') {
      if (current.rulesBrowser.open) return instructionsBrowserItems(entryList, current.rulesBrowser.showHidden);
      return instructionsItems(current);
    }
    if (current.agentDetail) return editorItems(current, current.agentDetail);
    return agentsListItems(current);
  };

  const syncScroll = (action: Action, nextFocus: string) => {
    dispatch(action);
    const index = Math.max(0, focusIds.indexOf(nextFocus));
    dispatch({ type: 'SCROLL', top: visibleWindow(focusIds, index, listHeight).top });
  };

  /**
   * Explicit Use-this-folder resolution: safety validation plus a
   * synchronous read-only refresh of the new target's saved configuration,
   * conflicts and editor status. Navigation alone never reaches this path.
   * Same-target use keeps committed choices; dirty session edits route to an
   * explanatory consent step instead of switching silently. Recoverable
   * failures stay in the picker with the committed target untouched.
   */
  const useTargetFolder = (current: SessionState): Action => {
    const dir = current.targetBrowser.dir;
    const problem = validateTargetDir(dir);
    if (problem) return { type: 'TARGET_ERROR', error: problem };
    if (dir === current.targetDir) return { type: 'CLOSE_TARGET_BROWSER' };
    try {
      const load = options.loadRefresh ?? ((d, h) => localTargetRefresh(d, h, current.skillConflicts));
      const refresh = load(dir, current.harness);
      if (current.settingsTouched) {
        return { type: 'REQUEST_TARGET', dir, config: refresh.config, skillConflicts: refresh.skillConflicts, vscodeKept: refresh.vscodeKept };
      }
      return { type: 'SET_TARGET', dir, config: refresh.config, skillConflicts: refresh.skillConflicts, vscodeKept: refresh.vscodeKept };
    } catch (error) {
      return { type: 'TARGET_ERROR', error: error instanceof Error ? error.message : 'Cannot use this folder' };
    }
  };

  const activate = (current: SessionState): Action | 'install' | null => {
    const id = current.focusId;
    if (current.step === 'directory') {
      if (isUseTarget(id) && current.targetBrowser.open && !current.targetPending) return useTargetFolder(current);
      return activateDirectory(current, id, targetEntryList);
    }
    if (current.step === 'review') return activateReview(current, id);
    if (current.step === 'instructions') return activateInstructions(current, id, entryList);
    if (current.agentDetail) {
      if (id === 'field:back') return { type: 'CLOSE_AGENT' };
      return activateEditor(current, current.agentDetail, id);
    }
    return activateAgentsList(current, id);
  };

  const toggle = (current: SessionState): Action | null => {
    // Checkbox rows keep their toggle; otherwise Space opens full details
    // for capped content, else it stays a no-op.
    if (current.step === 'instructions' && current.focusId === 'jev-scope') return { type: 'SET_JEV_SCOPE', scope: current.jevScope === 'personal' ? 'work' : 'personal' };
    if (current.step === 'instructions' && current.focusId === 'jev-provider') return { type: 'CYCLE_JEV_PROVIDER' };
    if (current.step === 'review' && current.focusId === 'adopt') {
      return { type: 'SET_ADOPT_SKILLS', adopt: !current.adoptSkills };
    }
    if (current.step === 'agents' && current.agentDetail && !current.draftFor) {
      const checkbox = toggleEditor(current, current.agentDetail, current.focusId);
      if (checkbox) return checkbox;
    }
    const detail = detailFor(current);
    if (detail) return { type: 'OPEN_DETAIL', title: detail.title, lines: detail.lines };
    return null;
  };

  /**
   * Full-detail content for Space: a capped diagnostic error wins over an
   * incidentally capped focused label (never open the label instead of the
   * error), else the capped focused item. Null when everything relevant
   * already fits — Space then stays a no-op. Drafts suppress item details
   * (the field shows the value); errors stay reachable while editing.
   */
  const detailFor = (current: SessionState): { title: string; lines: string[] } | null => {
    if (current.installRequested) return null;
    if (errorAlloc.capped) return { title: 'Error details', lines: [...errorAlloc.full] };
    // Notices that yield their rows remain available through the same
    // read-only pager, alongside (never instead of) focused-item details.
    const withNotice = (detail: { title: string; lines: string[] }) => suppressedNotice
      ? { ...detail, lines: [...detail.lines, '', ...wrapLines(`Note: ${current.notice}`, Math.max(8, menuWidth - 4))] }
      : detail;
    if (current.step === 'directory' && current.targetBrowser.open && !current.targetPending && current.focusId === 'info:browsed') {
      return withNotice({ title: 'Browsed folder (inspection only)', lines: wrapLines(current.targetBrowser.dir, Math.max(8, menuWidth - 4)) });
    }
    if (current.step === 'directory' && current.targetPending && current.focusId === 'target-confirm') {
      const item = directoryItems(current, [], minimal)[0];
      return withNotice({ title: 'Switch target: discard agent edits', lines: wrapLines(item.hint ?? item.label, Math.max(8, menuWidth - 4)) });
    }
    if (!current.draftFor) {
      const items = currentItems(current);
      const geo = menuGeometry(items, current.focusId, menuWidth, compact, hintMode, listHeight);
      if (geo.capped || suppressedNotice) {
        const focused = items.find((item) => item.id === current.focusId) ?? items[0];
        if (!focused) return null;
        // Strip the embedded focus marker: the detail list adds its own
        // position marker to the top line, so continuations stay aligned.
        const lines = itemRows(focused, true, menuWidth, compact, 'all').map((row, index) =>
          index === 0 ? row.replace(/^> /, '  ') : row,
        );
        return withNotice({ title: truncateCells(focused.label, menuWidth), lines });
      }
    }
    return null;
  };
  const shortcuts = state.installRequested
    ? ['Writing — input paused until writes finish, no cancellation']
    : state.detail
      ? ['↑↓/PgUp/PgDn scroll details', 'Enter/Space/Tab close', 'Esc quit']
      : state.step === 'directory'
        ? directoryShortcuts(state)
        : state.step === 'review'
          ? reviewShortcuts()
          : state.step === 'instructions'
            ? instructionsShortcuts(state)
            : agentsShortcuts(state);
  // Conservative footer measure for budgeting: the rendered footer can only
  // be shorter (Space details may be absent), never taller — budgets stay fit.
  const detailFooterText = ['↑↓/PgUp/PgDn scroll details', 'Enter/Space/Tab close', 'Esc quit'].join('  ·  ');
  const footerTotalForBudget = (compact ? 0 : 2) + (compact ? 1 : Math.max(
     Math.max(1, wrapLines([...shortcuts, 'Space warning/details'].join('  ·  '), Math.max(20, width - 4)).length),
    Math.max(1, wrapLines(detailFooterText, Math.max(20, width - 4)).length),
  ));
  // Total viewport budgeting: chrome + fixed screen rows + messages leave the
  // list budget; the line-aware menu never exceeds it.
  // Single source for error allocation AND display: global diagnostics and
  // the rules-browser diagnostic share one capped block, budgeted AFTER
  // reserving chrome, fixed content, notices and the actionable menu
  // minimum (focused row + both indicators). Overlays (detail, quit,
  // install progress) replace the body's messages instead of appending.
  const showMessages = !state.detail && !state.quitDialog && !state.installRequested;
  const requestedNoticeRows =
    roomy && showMessages && state.notice ? wrapLines(`Note: ${state.notice}`, menuWidth).length + 1 : 0;
  const discoveryRows =
    roomy && state.step === 'agents' && !state.agentDetail && state.discovery.status !== 'loading'
      ? wrapLines(state.discovery.detail, menuWidth).length + 1
      : 0;
  // Full-detail overlay budget: title plus a windowed slice of the lines.
  const detailFixed = 1 + (compact ? 0 : 1);
  // Static path wrapping must yield to the actionable menu. The confirmation
  // retains the exact path and the same visible Space/details inspection route.
  const directoryPathRows = Math.max(1, rows - headerRows(compact) - footerTotalForBudget - marginRows(compact)
    - directoryFixedRows(state, menuWidth, compact, minimal, 0) - 3);
  const screenFixed = (withDetails: boolean) =>
    state.installRequested
      ? 2
      : state.detail
        ? detailFixed
        : state.step === 'directory'
           ? directoryFixedRows(state, menuWidth, compact, minimal, directoryPathRows)
          : state.step === 'agents'
            ? agentsFixedRows(state, menuWidth, compact, roomy, minimal, hintMode, withDetails) + discoveryRows
            : state.step === 'instructions'
              ? instructionsFixedRows(state, menuWidth, compact, minimal, hintMode, withDetails)
              : reviewFixedRows(menuWidth, compact);
  // Advisory notices must yield to the focused action and its two window
  // indicators, including when a long directory consumes extra fixed rows.
  const noticeRows = requestedNoticeRows <= rows - headerRows(compact) - footerTotalForBudget - marginRows(compact) - screenFixed(false) - 3
    ? requestedNoticeRows : 0;
  const suppressedNotice = showMessages && !!state.notice && noticeRows === 0;
  const browserErrorText =
    state.step === 'instructions' && state.rulesBrowser.open ? entries.fsError : null;
  const targetErrorText =
    state.step === 'directory' && state.targetBrowser.open ? targetFsError : null;
  const errorBlocks = [
    ...(state.error ? [wrapLines(`Error: ${state.error}`, menuWidth)] : []),
    ...(browserErrorText ? [wrapLines(`Browser: ${browserErrorText}`, menuWidth)] : []),
    ...(targetErrorText ? [wrapLines(`Target: ${targetErrorText}`, menuWidth)] : []),
  ];
  const errorBudgetFor = (fixedRows: number) =>
    Math.max(
      1,
      rows - headerRows(compact) - footerTotalForBudget - marginRows(compact) - fixedRows - (showMessages ? noticeRows : 0) - 3,
    );
  // Pass 1 (no details row) decides whether the Error details action exists;
  // pass 2 recounts with it. Monotonic: a smaller budget can only cap more.
  const firstAlloc = allocateErrors(errorBlocks, showMessages ? errorBudgetFor(screenFixed(false)) : 0, menuWidth);
  const editDetailsAvailable =
    state.draftFor !== null && state.region === 1 && showMessages && firstAlloc.capped;
  const fixed = screenFixed(editDetailsAvailable);
  const errorAlloc = allocateErrors(errorBlocks, showMessages ? errorBudgetFor(fixed) : 0, menuWidth);
  const errorDisplay = showMessages ? errorAlloc.shown : [];
  const errorMargin = minimal || errorDisplay.length === 0 ? 0 : 1;
  const messageRows = noticeRows + errorDisplay.length + errorMargin;
  const listHeight = Math.max(1, rows - headerRows(compact) - footerTotalForBudget - marginRows(compact) - fixed - messageRows);
  // Full-detail overlay budget: title plus a windowed slice of the lines.
  const detailBudget = Math.max(1, rows - headerRows(compact) - footerTotalForBudget - marginRows(compact) - detailFixed);

  const focusIds = useMemo((): string[] => {
    if (state.draftFor && state.region === 1) return editActionIds(editDetailsAvailable);
    if (state.step === 'directory') return directoryFocusIds(state, targetEntryList, minimal);
    if (state.step === 'review') return reviewFocusIds(state);
    if (state.step === 'instructions') return instructionsFocusIds(state, entryList);
    if (state.agentDetail) return editorFocusIds(state, state.agentDetail);
    return agentsListFocusIds();
  }, [state, entries, targetList, editDetailsAvailable]);


  const ensureVisible = (action: Action) => {
    if (action.type === 'OPEN_AGENT' || action.type === 'NAV' || action.type === 'SET_EDITOR_FIELD') {
      dispatch({ type: 'SCROLL', top: 0 });
    }
  };

  const refocusAfterEdit = (current: SessionState, action: Action) => {
    dispatch(action);
    const next = reducer(current, action);
    if (next.step === 'agents' && next.agentDetail) {
      const ids = editorFocusIds(next, next.agentDetail);
      if (ids.length > 0) dispatch({ type: 'FOCUS', id: ids[0] });
    } else if (next.step === 'instructions' && !next.rulesBrowser.open) {
      dispatch({ type: 'FOCUS', id: 'rules-path' });
    }
    dispatch({ type: 'SET_REGION', region: 0 });
    dispatch({ type: 'SCROLL', top: 0 });
  };

  const commitDraft = (current: SessionState): void => {
    try {
      if (current.step === 'instructions') refocusAfterEdit(current, commitRulesPath(current));
      else if (current.step === 'agents' && current.agentDetail) refocusAfterEdit(current, commitEditorDraft(current, current.agentDetail));
      else dispatch({ type: 'CLEAR_DRAFT' });
    } catch (error) {
      dispatch({ type: 'ERROR', error: error instanceof Error ? error.message : 'Cannot commit edit' });
      dispatch({ type: 'SET_REGION', region: 0 });
    }
  };

  useInput((input: string, key: Key) => {
    if (done.current || state.installRequested) return;
    if (state.quitDialog) {
      if (key.return || key.escape) dispatch({ type: 'QUIT_CONTINUE' });
      else if (input === 'q' || input === 'Q' || (key.ctrl && input === 'c')) finishRef.current({ type: 'quit', state });
      return;
    }
    if (layout.mode === 'below-minimum') {
      if (key.escape || (key.ctrl && input === 'c')) dispatch({ type: 'REQUEST_QUIT' });
      return;
    }
    if (key.ctrl && input === 'c') {
      dispatch({ type: 'REQUEST_QUIT' });
      return;
    }
    // Full-detail overlay: non-mutating paging; focus/draft/config untouched.
    if (state.detail) {
      const total = state.detail.lines.length;
      if (key.upArrow) {
        dispatch({ type: 'DETAIL_SCROLL', top: state.detail.top - 1 });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: 'DETAIL_SCROLL', top: Math.min(state.detail.top + 1, Math.max(0, total - 1)) });
        return;
      }
      if (key.pageUp) {
        dispatch({ type: 'DETAIL_SCROLL', top: state.detail.top - Math.max(1, detailBudget - 1) });
        return;
      }
      if (key.pageDown) {
        dispatch({ type: 'DETAIL_SCROLL', top: Math.min(state.detail.top + Math.max(1, detailBudget - 1), Math.max(0, total - 1)) });
        return;
      }
      if (key.home) {
        dispatch({ type: 'DETAIL_SCROLL', top: 0 });
        return;
      }
      if (key.end) {
        dispatch({ type: 'DETAIL_SCROLL', top: Math.max(0, total - 1) });
        return;
      }
      // U5: Esc is the global quit confirmation everywhere — even over the
      // detail overlay. Close details only via explicit Enter/Space/Tab.
      if (key.escape) {
        dispatch({ type: 'REQUEST_QUIT' });
        return;
      }
      if (key.return || input === ' ' || key.tab) {
        dispatch({ type: 'CLOSE_DETAIL' });
        return;
      }
      return;
    }
    // Text editing: region 0 types into the draft; region 1 holds explicit
    // Commit/Cancel rows. Enter commits; Esc is the global safe quit dialog.
    if (state.draftFor) {
      if (key.tab) {
        if (state.region === 1) {
          dispatch({ type: 'SET_REGION', region: 0 });
        } else {
          dispatch({ type: 'SET_REGION', region: 1 });
          dispatch({ type: 'FOCUS', id: EDIT_COMMIT_ID });
        }
        return;
      }
      if (state.region === 1) {
        const actionIds = editActionIds(editDetailsAvailable);
        if (key.upArrow || key.downArrow || key.home || key.end || key.pageUp || key.pageDown) {
          dispatch({ type: 'FOCUS', id: moveFocus(actionIds, state.focusId, key) });
          return;
        }
        if (key.return) {
          if (state.focusId === EDIT_DETAILS_ID && editDetailsAvailable) {
            dispatch({ type: 'OPEN_DETAIL', title: 'Error details', lines: [...errorAlloc.full] });
            return;
          }
          if (state.focusId === EDIT_CANCEL_ID) {
            // Explicit cancel: discard only the draft, keep committed state.
            refocusAfterEdit(state, { type: 'CLEAR_DRAFT' });
          } else if (resolveEditAction(state.focusId) === 'commit') {
            commitDraft(state);
          }
          // Anything else (including a stale focus id whose row vanished)
          // is an explicit no-op: an invalid focus must never silently commit.
          return;
        }
        if (key.escape) {
          dispatch({ type: 'REQUEST_QUIT' });
          return;
        }
        return;
      }
      if (key.return) {
        commitDraft(state);
        return;
      }
      const { edit, cancelled } = editText({ value: state.draft, cursor: state.cursor }, input, key);
      if (cancelled) {
        dispatch({ type: 'REQUEST_QUIT' });
        return;
      }
      if (edit.value !== state.draft || edit.cursor !== state.cursor) {
        dispatch({ type: 'SET_DRAFT', for: state.draftFor, value: edit.value, cursor: edit.cursor });
      }
      return;
    }
    if (key.escape) {
      // Local cancellation first: browser, editor, and search clear locally.
      if (state.step === 'instructions' && state.rulesBrowser.open) {
        dispatch({ type: 'CLOSE_RULES_BROWSER' });
        return;
      }
      if (state.step === 'agents' && state.agentDetail) {
        if (state.region === 1) {
          dispatch({ type: 'SET_SEARCH', value: '' });
          dispatch({ type: 'SET_REGION', region: 0 });
          return;
        }
        dispatch({ type: 'CLOSE_AGENT' });
        return;
      }
      dispatch({ type: 'REQUEST_QUIT' });
      return;
    }
    if (key.tab) {
      if (regionCount > 1) {
        const next = (state.region + (key.shift ? regionCount - 1 : 1)) % regionCount;
        dispatch({ type: 'SET_REGION', region: next });
      }
      return;
    }
    // Search region of the OpenCode model picker: Enter commits the
    // advertised match/custom query (never the stale list focus).
    if (state.step === 'agents' && state.agentDetail && state.region === 1) {
      if (key.upArrow || key.downArrow) {
        dispatch({ type: 'SET_REGION', region: 0 });
        return;
      }
      if (key.return) {
        dispatch(commitSearch(state, state.agentDetail));
        return;
      }
      if (key.backspace) {
        dispatch({ type: 'SET_SEARCH', value: state.search.slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta && input >= ' ') {
        dispatch({ type: 'SET_SEARCH', value: state.search + input });
      }
      return;
    }
    if (key.upArrow || key.downArrow || key.home || key.end || key.pageUp || key.pageDown) {
      const next = moveFocus(focusIds, state.focusId, key);
      syncScroll({ type: 'FOCUS', id: next }, next);
      return;
    }
    if (key.return) {
      const action = activate(state);
      if (action === 'install') {
        dispatch({ type: 'REQUEST_INSTALL' });
      } else if (action) {
        dispatch(action);
        ensureVisible(action);
        if (action.type === 'SET_HARNESS') {
          // Harness switches refresh target-dependent conflicts/editor status
          // for the confirmed target; committed model choices are retained.
          // A failed refresh retains the entry conflicts — install-time
          // preflight still validates before any write.
          try {
            const load = options.loadRefresh ?? ((d, h) => localTargetRefresh(d, h, state.skillConflicts));
            const refresh = load(state.targetDir, action.harness);
            dispatch({ type: 'REFRESH_HARNESS', skillConflicts: refresh.skillConflicts, vscodeKept: refresh.vscodeKept });
          } catch {
            // Retain entry conflicts; never a write path.
          }
        }
        // Editors open on a field placeholder; land focus on the first row.
        if (action.type === 'OPEN_AGENT' || action.type === 'SET_EDITOR_FIELD') {
          const next = reducer(state, action);
          if (next.agentDetail) {
            const ids = editorFocusIds(next, next.agentDetail);
            if (ids.length > 0) dispatch({ type: 'FOCUS', id: ids[0] });
            dispatch({ type: 'SCROLL', top: 0 });
          }
        }
      }
      return;
    }
    if (input === ' ') {
      const action = toggle(state);
      if (action) dispatch(action);
    }
  });


  // Visible detail affordance: Space opens full details exactly when the
  // Space handler would (checkbox toggles keep precedence).
  const spaceOpensDetail =
    !state.detail && !state.draftFor && !state.installRequested && toggle(state)?.type === 'OPEN_DETAIL';
  const footerShortcuts = spaceOpensDetail
    ? [suppressedNotice && !errorAlloc.capped ? 'Space warning/details' : 'Space details', ...shortcuts]
    : shortcuts;
  const contextualShortcuts = layout.mode === 'below-minimum' ? ['Esc quit without writing'] : state.quitDialog ? ['Enter continue (safe default)', 'Q quit without writing'] : footerShortcuts;


  const body = state.installRequested ? (
    <Box flexDirection="column">
      <Text color={palette.cream} bold>{phase === 'validating' ? 'Validating installation…' : 'Writing team files…'}</Text>
      <Text color={palette.parchment}>{`Target: ${state.targetDir} — the shell stays mounted until writes finish.`}</Text>
    </Box>
  ) : state.detail ? (
    <Box flexDirection="column">
      <Text color={palette.cream} bold wrap="truncate">{state.detail.title}</Text>
      <Box marginTop={compact ? 0 : 1}>
        <MenuList
          items={state.detail.lines.map((line, index) => ({ id: `detail:${index}`, label: line }))}
          focusedId={`detail:${state.detail.top}`}
          viewportHeight={detailBudget}
          width={menuWidth}
          compact
          hintMode="none"
          bare
        />
      </Box>
    </Box>
  ) : state.step === 'directory' ? (
    <DirectoryScreen state={state} width={menuWidth} listHeight={listHeight} compact={compact} hintMode={hintMode} minimal={minimal} pathRows={directoryPathRows} />
  ) : state.step === 'agents' ? (
    <AgentsScreen state={state} width={menuWidth} listHeight={listHeight} compact={compact} roomy={roomy} hintMode={hintMode} minimal={minimal} editDetails={editDetailsAvailable} />
  ) : state.step === 'instructions' ? (
    <InstructionsScreen state={state} width={menuWidth} listHeight={listHeight} compact={compact} hintMode={hintMode} minimal={minimal} editDetails={editDetailsAvailable} />
  ) : (
    <ReviewScreen state={state} width={menuWidth} listHeight={listHeight} compact={compact} hintMode={hintMode} />
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header step={state.step} compact={compact} />
      {state.quitDialog ? (
        <Box flexDirection="column" marginTop={compact ? 0 : 1}>
          <QuitDialog compact={compact} />
          {!compact && <Text color={palette.parchment}>Enter continues · Q quits without writing · nothing has been written yet.</Text>}
        </Box>
      ) : layout.mode === 'below-minimum' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.clay} bold>{`Terminal too small (${columns}x${rows}; need at least 40x8).`}</Text>
          <Text color={palette.parchment}>Resize the terminal to continue — your session is preserved and nothing will be written. Esc quits without writing.</Text>
        </Box>
      ) : (
        <Box marginTop={compact ? 0 : 1} flexDirection={layout.avatar && art ? 'row' : 'column'}>
          {layout.avatar && art && (
            <Box marginRight={3} flexDirection="column" flexShrink={0} width={art.cols}>
              <Avatar art={art} truecolor={truecolor} />
            </Box>
          )}
          <Box flexDirection="column" flexGrow={1}>
            {body}
            {!state.installRequested && state.notice && noticeRows > 0 && <Message kind="notice" text={state.notice} />}
            {!state.installRequested && errorDisplay.length > 0 && (
              <Box marginTop={minimal ? 0 : 1} flexDirection="column">
                {errorDisplay.map((line, index) => (
                  <Text key={index} color={palette.clay} wrap="truncate">{line}</Text>
                ))}
              </Box>
            )}
            {!state.installRequested && roomy && state.step === 'agents' && !state.agentDetail && state.discovery.status !== 'loading' && (
              <Box marginTop={1}>
                <Text color={palette.parchment} wrap="wrap">{state.discovery.detail}</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
      <Box marginTop={compact ? 0 : 1}>
        <Footer shortcuts={contextualShortcuts} compact={compact} />
      </Box>
    </Box>
  );
}

/** Re-exported for the rules browser commit path (loaded-file errors stay local). */
export { commitBrowserFile };
