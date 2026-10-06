/*
 * Concept film: posting through the Sharetopus MCP takes two calls (list_connections, then
 * publish_posts), and list_posts with the returned batch_id checks the result. Every value comes
 * from scripts/films/mcp-two-calls.values.json (scripts/films/computeMcpTwoCallsValues.ts).
 */
(function () {
  'use strict';

  const VALUES = {
    accounts: [
      { platform: 'LinkedIn', status: 'ok' },
      { platform: 'Bluesky', status: 'ok' },
      { platform: 'TikTok', status: 'needs_reconnect' }
    ],
    batchIdShort: 'wVh-…bRBC',
    blueskyScheduledLabel: 'Fri 09:00 ET',
    listedStatuses: ['published', 'scheduled']
  };

  // One row per call; the tool name sits at the left, its result in three 168 px slots.
  const ROW_CENTER_Y = [82, 192, 302];
  const TILE_HEIGHT = 46;
  const TILE_WIDTH = 168;
  const SLOT_X = [250, 430, 610];
  const LABEL_X = 40;
  const ARROW_X1 = 204;
  const ARROW_X2 = 238;
  // The one stagger for every sequenced group, in seconds (design-playbook 3.2).
  const STAGGER = 0.05;

  function tileTop(rowIndex) {
    return ROW_CENTER_Y[rowIndex] - TILE_HEIGHT / 2;
  }

  function slotCenter(slotIndex) {
    return SLOT_X[slotIndex] + TILE_WIDTH / 2;
  }

  /** Writes a call's tool name in the focus color with its arrow, then settles it to ink. */
  function startCall(scene, rowIndex, toolName, start) {
    const { palette } = scene;
    scene.label('call-' + rowIndex, LABEL_X, ROW_CENTER_Y[rowIndex], toolName, { size: 15, font: 'mono', color: palette.yellow });
    scene.add('arrow-' + rowIndex, 'arrow', { x1: ARROW_X1, y1: ROW_CENTER_Y[rowIndex], x2: ARROW_X2, y2: ROW_CENTER_Y[rowIndex], color: palette.muted, opacity: 1, fraction: 0 });
    scene.write('call-' + rowIndex, start, 0.8).draw('arrow-' + rowIndex, start + 0.6, 0.5);
  }

  function settleCall(scene, rowIndex, start) {
    scene.recolor('call-' + rowIndex, scene.palette.ink, start, 0.4);
  }

  function buildMcpTwoCalls(scene) {
    const { palette } = scene;

    // 1. the request, then list_connections returns every account with its status
    scene.say(0.2, 'An agent posts to LinkedIn now and to Bluesky on Friday at 09:00 ET.');
    const firstCall = 3.4;
    scene.say(firstCall, 'First call, list_connections: each account comes back with its id and status.');
    startCall(scene, 0, 'list_connections', firstCall + 0.2);
    VALUES.accounts.forEach((account, slotIndex) => {
      const isAvailable = account.status === 'ok';
      scene.add('account-' + slotIndex, 'rect', { x: SLOT_X[slotIndex], y: tileTop(0), width: TILE_WIDTH, height: TILE_HEIGHT,
        color: isAvailable ? palette.blue : palette.rest, text: account.platform, ink: isAvailable ? palette.background : palette.ink, size: 16, font: 'display' });
      scene.label('status-' + slotIndex, slotCenter(slotIndex), tileTop(0) + TILE_HEIGHT + 16, account.status,
        { size: 13, font: 'mono', anchor: 'middle', color: palette.muted });
      scene.fadeIn('account-' + slotIndex, firstCall + 1.6 + slotIndex * STAGGER, 0.6);
      scene.fadeIn('status-' + slotIndex, firstCall + 2.0 + slotIndex * STAGGER, 0.6);
    });

    const sitOut = firstCall + 4.2;
    scene.say(sitOut, 'TikTok needs a reconnect, so it sits out. The two other ids go into the next call.');
    scene.indicate('status-2', sitOut + 0.3);
    settleCall(scene, 0, sitOut + 0.3);

    // 2. publish_posts: the two available accounts slide down into one entry each
    const secondCall = sitOut + 4.0;
    scene.say(secondCall, 'Second call, publish_posts: one entry per account. Only Bluesky has a scheduled_at.');
    startCall(scene, 1, 'publish_posts', secondCall + 0.2);
    [0, 1].forEach((slotIndex) => {
      const entryId = 'entry-' + slotIndex;
      scene.add(entryId, 'rect', { x: SLOT_X[slotIndex], y: tileTop(0), width: TILE_WIDTH, height: TILE_HEIGHT, color: palette.blue,
        text: VALUES.accounts[slotIndex].platform, ink: palette.background, size: 16, font: 'display' });
      scene.animate(entryId, 'opacity', 0, 1, secondCall + 1.4, 0.05);
      scene.animateTo(entryId, { y: tileTop(1) }, secondCall + 1.4 + slotIndex * STAGGER, 0.8);
    });
    scene.label('timing-0', slotCenter(0), tileTop(1) + TILE_HEIGHT + 16, 'no scheduled_at', { size: 13, font: 'mono', anchor: 'middle', color: palette.muted });
    scene.label('timing-1', slotCenter(1), tileTop(1) + TILE_HEIGHT + 16, 'scheduled_at ' + VALUES.blueskyScheduledLabel, { size: 13, font: 'mono', anchor: 'middle', color: palette.muted });
    scene.fadeIn('timing-0', secondCall + 2.6, 0.6).fadeIn('timing-1', secondCall + 2.6 + STAGGER, 0.6);

    // the server answers: no scheduled_at publishes now, a scheduled_at waits, one batch_id groups both
    const outcome = secondCall + 5.0;
    scene.say(outcome, 'No scheduled_at publishes now, a scheduled_at waits. The reply carries one batch_id.');
    scene.recolor('entry-0', palette.green, outcome + 0.4, 0.4, palette.background);
    scene.recolor('entry-1', palette.teal, outcome + 0.4 + STAGGER, 0.4, palette.background);
    scene.label('batch-label', SLOT_X[2], ROW_CENTER_Y[1] - 12, 'batch_id', { size: 13, font: 'mono', color: palette.muted });
    scene.label('batch-value', SLOT_X[2], ROW_CENTER_Y[1] + 12, VALUES.batchIdShort, { size: 17, font: 'mono', color: palette.yellow });
    scene.fadeIn('batch-label', outcome + 1.4, 0.6).fadeIn('batch-value', outcome + 1.4 + STAGGER, 0.6);
    scene.indicate('batch-value', outcome + 2.2);
    settleCall(scene, 1, outcome + 2.2);

    // 3. list_posts with the batch_id shows each post's state
    const thirdCall = outcome + 4.6;
    scene.say(thirdCall, 'Then list_posts with that batch_id shows what happened to each post.');
    startCall(scene, 2, 'list_posts', thirdCall + 0.2);
    VALUES.listedStatuses.forEach((status, slotIndex) => {
      const resultId = 'result-' + slotIndex;
      scene.add(resultId, 'rect', { x: SLOT_X[slotIndex], y: tileTop(2), width: TILE_WIDTH, height: TILE_HEIGHT,
        color: slotIndex === 0 ? palette.green : palette.teal, text: status, ink: palette.background, size: 14, font: 'mono' });
      scene.fadeIn(resultId, thirdCall + 1.4 + slotIndex * STAGGER, 0.6);
    });
    settleCall(scene, 2, thirdCall + 2.4);

    // the result the poster keeps
    const closing = thirdCall + 4.0;
    scene.say(closing, 'Two calls to post. One more to check.');
    scene.label('summary-post', SLOT_X[2], ROW_CENTER_Y[2] - 11, 'Two calls to post', { size: 19, color: palette.yellow });
    scene.label('summary-check', SLOT_X[2], ROW_CENTER_Y[2] + 15, 'One to check', { size: 15, color: palette.muted });
    scene.write('summary-post', closing + 0.3, 0.8).write('summary-check', closing + 1.1, 0.6);
    scene.indicate('summary-post', closing + 2.0);
    scene.endAt(closing + 4);
  }

  ConceptFilms.define('mcp-two-calls', {
    title: 'Posting through MCP takes two calls',
    caption: 'list_connections gives the account ids, publish_posts posts to each, list_posts checks the result.',
    build: buildMcpTwoCalls
  });
})();
