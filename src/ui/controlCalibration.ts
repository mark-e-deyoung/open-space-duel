/**
 * ControlCalibration — gamepad deadzone, touch ring, and tilt calibration UI.
 *
 * Extracted from MainMenu to reduce the god-file size.
 * Reads/writes localStorage directly. Purely DOM-driven.
 */

export interface CalibrationHandles {
  /** Call to tear down sensor listeners and stop polling. */
  detach(): void;
  /** Returns the interval timer ID stored on the parent for lifecycle management. */
  updateTimer: ReturnType<typeof setInterval> | null;
}

export function renderControlCalibration(
  container: HTMLDivElement,
  onBack: () => void,
): CalibrationHandles {
  type TouchControlConfig = {
    rotateRing: number;
    thrustRing: number;
    updatedAt: number;
  };
  type TiltProfile = {
    neutralGamma: number;
    neutralBeta: number;
    neutralCaptured: boolean;
    deadzone: number;
    sensitivity: number;
    invertSteer: boolean;
    invertThrust: boolean;
    updatedAt: number;
  };

  const touchKey = 'osd_touch_controls';
  const tiltKey = 'osd_tilt_profile';

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const defaultTouch = (): TouchControlConfig => ({
    rotateRing: 8,
    thrustRing: 35,
    updatedAt: Date.now(),
  });

  const loadTouch = (): TouchControlConfig => {
    try {
      const saved = localStorage.getItem(touchKey);
      if (!saved) return defaultTouch();
      const parsed = JSON.parse(saved) as Partial<TouchControlConfig>;
      const rotateRing = clamp(
        typeof parsed.rotateRing === 'number' ? parsed.rotateRing : 8,
        4,
        28,
      );
      const thrustRing = clamp(
        typeof parsed.thrustRing === 'number' ? parsed.thrustRing : 35,
        rotateRing + 8,
        60,
      );
      return {
        rotateRing,
        thrustRing,
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    } catch {
      return defaultTouch();
    }
  };

  const saveTouch = (config: TouchControlConfig) => {
    const normalized: TouchControlConfig = {
      rotateRing: clamp(config.rotateRing, 4, 28),
      thrustRing: clamp(config.thrustRing, 18, 60),
      updatedAt: Date.now(),
    };
    if (normalized.thrustRing < normalized.rotateRing + 8) {
      normalized.thrustRing = clamp(normalized.rotateRing + 8, 18, 60);
    }
    localStorage.setItem(touchKey, JSON.stringify(normalized));
  };

  const defaultTilt = (): TiltProfile => ({
    neutralGamma: 0,
    neutralBeta: 0,
    neutralCaptured: false,
    deadzone: 12,
    sensitivity: 1,
    invertSteer: false,
    invertThrust: false,
    updatedAt: Date.now(),
  });

  const loadTilt = (): TiltProfile => {
    try {
      const saved = localStorage.getItem(tiltKey);
      if (!saved) return defaultTilt();
      const parsed = JSON.parse(saved) as Partial<TiltProfile>;
      return {
        neutralGamma:
          typeof parsed.neutralGamma === 'number' ? parsed.neutralGamma : 0,
        neutralBeta:
          typeof parsed.neutralBeta === 'number' ? parsed.neutralBeta : 0,
        neutralCaptured: !!parsed.neutralCaptured,
        deadzone: clamp(
          typeof parsed.deadzone === 'number' ? parsed.deadzone : 12,
          2,
          45,
        ),
        sensitivity: clamp(
          typeof parsed.sensitivity === 'number' ? parsed.sensitivity : 1,
          0.5,
          2.5,
        ),
        invertSteer: !!parsed.invertSteer,
        invertThrust: !!parsed.invertThrust,
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    } catch {
      return defaultTilt();
    }
  };

  const saveTilt = (profile: TiltProfile) => {
    localStorage.setItem(
      tiltKey,
      JSON.stringify({
        ...profile,
        deadzone: clamp(profile.deadzone, 2, 45),
        sensitivity: clamp(profile.sensitivity, 0.5, 2.5),
        updatedAt: Date.now(),
      }),
    );
  };

  const supportsTilt = typeof window.DeviceOrientationEvent === 'function';
  let liveTilt: { gamma: number; beta: number } | null = null;
  let tiltListenerAttached = false;
  let tiltPermissionGranted = false;

  const renderTiltReadout = () => {
    const panel = container.querySelector(
      '#tilt-live-readout',
    ) as HTMLDivElement | null;
    const profile = loadTilt();
    if (!panel) return;
    const gamma = liveTilt?.gamma ?? 0;
    const beta = liveTilt?.beta ?? 0;
    const baselineGamma = profile.neutralCaptured ? profile.neutralGamma : 0;
    const baselineBeta = profile.neutralCaptured ? profile.neutralBeta : 0;
    const deltaGamma = gamma - baselineGamma;
    const deltaBeta = beta - baselineBeta;
    const angle = (() => {
      const orientation = window.screen?.orientation;
      if (orientation && typeof orientation.angle === 'number')
        return ((orientation.angle % 360) + 360) % 360;
      const legacy = (window as Window & { orientation?: number }).orientation;
      if (typeof legacy === 'number') return ((legacy % 360) + 360) % 360;
      return window.innerWidth > window.innerHeight ? 90 : 0;
    })();

    let steerValue = deltaGamma,
      thrustValue = deltaBeta;
    if (angle === 90) {
      steerValue = deltaBeta;
      thrustValue = -deltaGamma;
    } else if (angle === 180) {
      steerValue = -deltaGamma;
      thrustValue = -deltaBeta;
    } else if (angle === 270) {
      steerValue = -deltaBeta;
      thrustValue = deltaGamma;
    }
    if (profile.invertSteer) steerValue *= -1;
    if (profile.invertThrust) thrustValue *= -1;
    const steerActive =
      Math.abs(steerValue * profile.sensitivity) > profile.deadzone;
    const thrustActive =
      Math.abs(thrustValue * profile.sensitivity) > profile.deadzone;

    panel.innerHTML =
      `<div>STATUS: ${tiltPermissionGranted ? 'SENSOR READY' : 'SENSOR OFF'}</div>` +
      `<div>GAMMA: ${gamma.toFixed(1)} | BETA: ${beta.toFixed(1)}</div>` +
      `<div>DELTA: ${deltaGamma.toFixed(1)} / ${deltaBeta.toFixed(1)}</div>` +
      `<div>STEER: ${steerValue.toFixed(1)} (${steerActive ? 'ACTIVE' : 'IDLE'})</div>` +
      `<div>THRUST: ${thrustValue.toFixed(1)} (${thrustActive ? 'ACTIVE' : 'IDLE'})</div>` +
      `<div>BASELINE: ${profile.neutralCaptured ? 'CAPTURED' : 'AUTO'}</div>`;
  };

  const handleTiltOrientation = (event: DeviceOrientationEvent) => {
    liveTilt = {
      gamma: Number.isFinite(event.gamma) ? Number(event.gamma) : 0,
      beta: Number.isFinite(event.beta) ? Number(event.beta) : 0,
    };
    renderTiltReadout();
  };

  const attachTilt = async () => {
    if (!supportsTilt || tiltListenerAttached) return;
    const DeviceOrientationEventExtended =
      DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
      };

    if (
      typeof DeviceOrientationEventExtended.requestPermission === 'function'
    ) {
      try {
        const permissionState =
          await DeviceOrientationEventExtended.requestPermission();
        if (permissionState !== 'granted') {
          renderTiltReadout();
          return;
        }
      } catch (e) {
        console.error(e);
        renderTiltReadout();
        return;
      }
    }

    window.addEventListener('deviceorientation', handleTiltOrientation);
    window.addEventListener('deviceorientationabsolute', handleTiltOrientation);
    tiltListenerAttached = true;
    tiltPermissionGranted = true;
    renderTiltReadout();
  };

  const detachTilt = () => {
    if (!tiltListenerAttached) return;
    window.removeEventListener('deviceorientation', handleTiltOrientation);
    window.removeEventListener(
      'deviceorientationabsolute',
      handleTiltOrientation,
    );
    tiltListenerAttached = false;
    tiltPermissionGranted = false;
  };

  // ── Render HTML ──────────────────────────────────────────────────

  container.innerHTML =
    '<div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; box-sizing: border-box; overflow-y: auto;">' +
    '<h2 style="color: #00ffcc; margin: 8px 0 0; letter-spacing: 0;">CONTROL CALIBRATION</h2>' +
    '<div id="gamepad-test-area" style="width: 100%; max-width: 560px; border: 1px solid #333; padding: 14px; border-radius: 8px; background: rgba(0,0,0,0.5); min-height: 160px; overflow-y: auto;">' +
    '<p style="color: #666; text-align: center; margin: 58px 0;">Press any button to start testing...</p>' +
    '</div>' +
    '<div style="width: 100%; max-width: 560px; border: 1px solid #333; padding: 14px; border-radius: 8px; background: rgba(0,0,0,0.5); box-sizing: border-box;">' +
    '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px;">' +
    '<div style="color: #ffaa00; font-size: 13px; font-weight: bold;">VIRTUAL GAMEPAD</div>' +
    '<div style="font-size: 10px; color: #888;">Touch ring sizing</div>' +
    '</div>' +
    '<div style="display: flex; flex-direction: column; gap: 12px;">' +
    '<div><div style="display: flex; justify-content: space-between; font-size: 11px; color: #fff;"><span>ROTATE RING</span><span id="touch-rotate-label"></span></div>' +
    '<input type="range" id="touch-rotate-slider" min="4" max="28" step="1" style="width: 100%;"></div>' +
    '<div><div style="display: flex; justify-content: space-between; font-size: 11px; color: #fff;"><span>THRUST RING</span><span id="touch-thrust-label"></span></div>' +
    '<input type="range" id="touch-thrust-slider" min="18" max="60" step="1" style="width: 100%;"></div>' +
    '<div style="font-size: 10px; color: #888; line-height: 1.4;">Use a wider rotate ring if your thumbs drift into thrust too easily. Keep the thrust ring farther out so a deliberate push is needed to trigger thrust.</div>' +
    '</div></div>' +
    '<div style="width: 100%; max-width: 560px; border: 1px solid #333; padding: 14px; border-radius: 8px; background: rgba(0,0,0,0.5); box-sizing: border-box;">' +
    '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px;">' +
    '<div style="color: #00ffcc; font-size: 13px; font-weight: bold;">TILT CALIBRATION</div>' +
    `<div id="tilt-support-label" style="font-size: 10px; color: #888;">${supportsTilt ? 'SUPPORTED' : 'NOT AVAILABLE'}</div></div>` +
    '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">' +
    '<button id="btn-tilt-enable" style="padding: 8px 12px; background: #111; color: #00ffcc; border: 1px solid #00ffcc; border-radius: 4px; cursor: pointer;">ENABLE SENSOR</button>' +
    '<button id="btn-tilt-capture" style="padding: 8px 12px; background: #111; color: #ffaa00; border: 1px solid #ffaa00; border-radius: 4px; cursor: pointer;">CAPTURE NEUTRAL</button>' +
    '<button id="btn-tilt-reset" style="padding: 8px 12px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px; cursor: pointer;">RESET</button>' +
    '</div>' +
    '<div style="display: flex; flex-direction: column; gap: 12px;">' +
    '<div><div style="display: flex; justify-content: space-between; font-size: 11px; color: #fff;"><span>DEADZONE</span><span id="tilt-deadzone-label"></span></div>' +
    '<input type="range" id="tilt-deadzone-slider" min="2" max="45" step="1" style="width: 100%;"></div>' +
    '<div><div style="display: flex; justify-content: space-between; font-size: 11px; color: #fff;"><span>SENSITIVITY</span><span id="tilt-sensitivity-label"></span></div>' +
    '<input type="range" id="tilt-sensitivity-slider" min="50" max="250" step="1" style="width: 100%;"></div>' +
    '<label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #ccc;"><input type="checkbox" id="tilt-invert-steer"> Invert steer</label>' +
    '<label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #ccc;"><input type="checkbox" id="tilt-invert-thrust"> Invert thrust</label>' +
    '<div id="tilt-live-readout" style="font-size: 11px; line-height: 1.5; color: #ddd; padding: 10px; border-radius: 4px; background: rgba(255,255,255,0.03); min-height: 92px;">Waiting for orientation data...</div>' +
    '</div></div>' +
    '<button id="btn-calibration-back" style="margin-top: 6px; margin-bottom: 6px; padding: 14px 26px; background: #111; color: #00ffcc; border: 2px solid #00ffcc; font-weight: bold; border-radius: 4px; cursor: pointer;">BACK TO SETUP</button>' +
    '</div>';

  // ── Wire event handlers ──────────────────────────────────────────

  const testArea = container.querySelector(
    '#gamepad-test-area',
  ) as HTMLDivElement;
  const touchRotateSlider = container.querySelector(
    '#touch-rotate-slider',
  ) as HTMLInputElement;
  const touchThrustSlider = container.querySelector(
    '#touch-thrust-slider',
  ) as HTMLInputElement;
  const touchRotateLabel = container.querySelector(
    '#touch-rotate-label',
  ) as HTMLSpanElement;
  const touchThrustLabel = container.querySelector(
    '#touch-thrust-label',
  ) as HTMLSpanElement;
  const tiltDeadzoneSlider = container.querySelector(
    '#tilt-deadzone-slider',
  ) as HTMLInputElement;
  const tiltSensitivitySlider = container.querySelector(
    '#tilt-sensitivity-slider',
  ) as HTMLInputElement;
  const tiltDeadzoneLabel = container.querySelector(
    '#tilt-deadzone-label',
  ) as HTMLSpanElement;
  const tiltSensitivityLabel = container.querySelector(
    '#tilt-sensitivity-label',
  ) as HTMLSpanElement;
  const tiltInvertSteer = container.querySelector(
    '#tilt-invert-steer',
  ) as HTMLInputElement;
  const tiltInvertThrust = container.querySelector(
    '#tilt-invert-thrust',
  ) as HTMLInputElement;
  const btnTiltEnable = container.querySelector(
    '#btn-tilt-enable',
  ) as HTMLButtonElement;
  const btnTiltCapture = container.querySelector(
    '#btn-tilt-capture',
  ) as HTMLButtonElement;
  const btnTiltReset = container.querySelector(
    '#btn-tilt-reset',
  ) as HTMLButtonElement;
  const btnBack = container.querySelector(
    '#btn-calibration-back',
  ) as HTMLButtonElement;

  const syncTouchInputs = () => {
    const touch = loadTouch();
    touchRotateSlider.value = String(touch.rotateRing);
    touchThrustSlider.value = String(touch.thrustRing);
    if (touchRotateLabel) touchRotateLabel.innerText = `${touch.rotateRing}px`;
    if (touchThrustLabel) touchThrustLabel.innerText = `${touch.thrustRing}px`;
  };

  const syncTiltInputs = () => {
    const tilt = loadTilt();
    tiltDeadzoneSlider.value = String(tilt.deadzone);
    tiltSensitivitySlider.value = String(Math.round(tilt.sensitivity * 100));
    tiltInvertSteer.checked = tilt.invertSteer;
    tiltInvertThrust.checked = tilt.invertThrust;
    if (tiltDeadzoneLabel) tiltDeadzoneLabel.innerText = `${tilt.deadzone}°`;
    if (tiltSensitivityLabel)
      tiltSensitivityLabel.innerText = `${tilt.sensitivity.toFixed(2)}x`;
    if (btnTiltCapture) {
      btnTiltCapture.disabled = !supportsTilt || !tiltListenerAttached;
      btnTiltCapture.style.opacity = btnTiltCapture.disabled ? '0.5' : '1';
    }
    if (btnTiltEnable) {
      btnTiltEnable.innerText = tiltPermissionGranted
        ? 'SENSOR READY'
        : 'ENABLE SENSOR';
      btnTiltEnable.style.borderColor = tiltPermissionGranted
        ? '#00ff00'
        : '#00ffcc';
      btnTiltEnable.style.color = tiltPermissionGranted ? '#00ff00' : '#00ffcc';
    }
    if (btnTiltReset) {
      btnTiltReset.disabled = !supportsTilt;
      btnTiltReset.style.opacity = !supportsTilt ? '0.5' : '1';
    }
  };

  touchRotateSlider.oninput = () => {
    const current = loadTouch();
    const rotateRing = parseInt(touchRotateSlider.value, 10);
    const thrustRing = Math.max(
      rotateRing + 8,
      parseInt(touchThrustSlider.value, 10),
    );
    saveTouch({ ...current, rotateRing, thrustRing });
    syncTouchInputs();
  };
  touchThrustSlider.oninput = () => {
    const current = loadTouch();
    const rotateRing = parseInt(touchRotateSlider.value, 10);
    const thrustRing = Math.max(
      rotateRing + 8,
      parseInt(touchThrustSlider.value, 10),
    );
    saveTouch({ ...current, rotateRing, thrustRing });
    syncTouchInputs();
  };
  tiltDeadzoneSlider.oninput = () => {
    saveTilt({
      ...loadTilt(),
      deadzone: parseInt(tiltDeadzoneSlider.value, 10),
    });
    syncTiltInputs();
    renderTiltReadout();
  };
  tiltSensitivitySlider.oninput = () => {
    saveTilt({
      ...loadTilt(),
      sensitivity: parseInt(tiltSensitivitySlider.value, 10) / 100,
    });
    syncTiltInputs();
    renderTiltReadout();
  };
  tiltInvertSteer.onchange = () => {
    saveTilt({ ...loadTilt(), invertSteer: tiltInvertSteer.checked });
    syncTiltInputs();
    renderTiltReadout();
  };
  tiltInvertThrust.onchange = () => {
    saveTilt({ ...loadTilt(), invertThrust: tiltInvertThrust.checked });
    syncTiltInputs();
    renderTiltReadout();
  };
  btnTiltEnable.onclick = async () => {
    if (!supportsTilt) return;
    await attachTilt();
    syncTiltInputs();
  };
  btnTiltCapture.onclick = () => {
    const profile = loadTilt();
    if (!liveTilt) return;
    saveTilt({
      ...profile,
      neutralGamma: liveTilt.gamma,
      neutralBeta: liveTilt.beta,
      neutralCaptured: true,
    });
    syncTiltInputs();
    renderTiltReadout();
  };
  btnTiltReset.onclick = () => {
    localStorage.setItem(tiltKey, JSON.stringify(defaultTilt()));
    syncTiltInputs();
    renderTiltReadout();
  };

  const renderGamepads = () => {
    if (!testArea) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let html = '';
    let found = false;
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp) continue;
      found = true;
      const savedDeadzone = localStorage.getItem('osd_deadzone_' + gp.id);
      const currentDeadzone = savedDeadzone ? parseFloat(savedDeadzone) : 0.25;
      html += `<div style="margin-bottom: 16px; border-bottom: 1px solid #222; padding-bottom: 10px;">`;
      html += `<div style="font-size: 11px; color: #00ffcc; font-weight: bold;">[${i}] ${gp.id}</div>`;
      html += `<div style="margin: 8px 0;"><div style="font-size: 10px; color: #fff;">STICK DEADZONE: ${Math.round(currentDeadzone * 100)}%</div>`;
      html += `<input type="range" class="deadzone-slider" data-id="${gp.id}" min="5" max="50" value="${currentDeadzone * 100}" style="width: 100%;"></div></div>`;
    }
    if (!found)
      html =
        '<p style="color: #666; text-align: center; margin: 56px 0;">No gamepads detected.</p>';
    testArea.innerHTML = html;
    testArea.querySelectorAll('.deadzone-slider').forEach((slider) => {
      (slider as HTMLInputElement).oninput = (e) => {
        const id = (slider as HTMLElement).getAttribute('data-id');
        if (id)
          localStorage.setItem(
            'osd_deadzone_' + id,
            (parseFloat((e.target as HTMLInputElement).value) / 100).toString(),
          );
      };
    });
  };

  syncTouchInputs();
  syncTiltInputs();
  renderGamepads();
  renderTiltReadout();

  const updateTimer = setInterval(() => {
    renderGamepads();
    renderTiltReadout();
  }, 100);

  btnBack.onclick = () => {
    detachTilt();
    if (updateTimer) clearInterval(updateTimer);
    onBack();
  };

  return { detach: detachTilt, updateTimer };
}
