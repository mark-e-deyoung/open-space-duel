import controlMap from './control-map.json';

export function renderKeyboardControlsMarkdown(): string {
  const standard = controlMap.keyboard.standard;
  const player1 = controlMap.keyboard.localPlayer1;
  const player2 = controlMap.keyboard.localPlayer2;

  return [
    'The keyboard bindings below are a human-readable projection of `src/game/input/control-map.json`, which also drives runtime keyboard input and the first-visit tutorial. `tests/controlMapContract.test.ts` prevents those surfaces from drifting silently.',
    '',
    '### Solo / Networked',
    `*   **Thrust:** \`${standard.thrust.label}\``,
    `*   **Steer:** \`${standard.left.label}\` · \`${standard.right.label}\``,
    `*   **Primary Fire:** \`${standard.fire.label}\``,
    `*   **Secondary Fire:** \`${standard.fireSecondary.label}\``,
    `*   **Shields:** \`${standard.shield.label}\``,
    `*   **Pause:** \`${standard.pause.label}\``,
    '',
    '### Local Multiplayer — Player 1',
    `*   **Thrust:** \`${player1.thrust.label}\``,
    `*   **Steer:** \`${player1.left.label}\` · \`${player1.right.label}\``,
    `*   **Primary Fire:** \`${player1.fire.label}\``,
    `*   **Secondary Fire:** \`${player1.fireSecondary.label}\``,
    `*   **Shields:** \`${player1.shield.label}\``,
    `*   **Pause:** \`${player1.pause.label}\``,
    '',
    '### Local Multiplayer — Player 2',
    `*   **Thrust:** \`${player2.thrust.label}\``,
    `*   **Steer:** \`${player2.left.label}\` · \`${player2.right.label}\``,
    `*   **Primary Fire:** \`${player2.fire.label}\``,
    `*   **Secondary Fire:** \`${player2.fireSecondary.label}\``,
    `*   **Shields:** \`${player2.shield.label}\``,
  ].join('\n');
}
