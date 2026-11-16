import { fromUint8Array, toUint8Array } from 'js-base64';
import { strToU8, zlibSync, unzlibSync, strFromU8 } from 'fflate';
import {
  parseFlightSessionDescriptor,
  type FlightSessionDescriptor,
} from '../flightSession';

export interface SignalingMessage {
  type: 'offer' | 'answer';
  sdp: string;
  /** Required for versioned manual duels; absent only on legacy links. */
  session?: FlightSessionDescriptor;
}

function compressAndEncode(msg: SignalingMessage): string {
  const jsonStr = JSON.stringify(msg);
  const u8 = strToU8(jsonStr);
  const compressed = zlibSync(u8, { level: 9 });
  return fromUint8Array(compressed, true); // URL safe base64
}

function decodeAndDecompress(payload: string): SignalingMessage {
  const compressed = toUint8Array(payload);
  const u8 = unzlibSync(compressed);
  const jsonStr = strFromU8(u8);
  return JSON.parse(jsonStr) as SignalingMessage;
}

export function createInviteLink(offer: RTCSessionDescriptionInit): string {
  const msg: SignalingMessage = { type: 'offer', sdp: offer.sdp! };
  const payload = compressAndEncode(msg);
  return `${window.location.origin}${window.location.pathname}#invite=${payload}`;
}

export function createResponseLink(answer: RTCSessionDescriptionInit): string {
  const msg: SignalingMessage = { type: 'answer', sdp: answer.sdp! };
  const payload = compressAndEncode(msg);
  return `${window.location.origin}${window.location.pathname}#response=${payload}`;
}

/** Versioned browser-P2P link: no legacy mode or seed fallback. */
export function createVersionedInviteLink(
  offer: RTCSessionDescriptionInit,
  session: FlightSessionDescriptor,
): string {
  const canonical = parseFlightSessionDescriptor(session);
  if (
    !canonical || typeof offer.sdp !== 'string' ||
    !offer.sdp.startsWith('v=0') || offer.sdp.length > 65536
  ) {
    throw new RangeError('Invalid versioned WebRTC offer');
  }
  const msg: SignalingMessage = { type: 'offer', sdp: offer.sdp, session: canonical };
  return `${window.location.origin}${window.location.pathname}#invite=${compressAndEncode(msg)}`;
}

/** Versioned guest acknowledgement explicitly echoes the host ruleset. */
export function createVersionedResponseLink(
  answer: RTCSessionDescriptionInit,
  session: FlightSessionDescriptor,
): string {
  const canonical = parseFlightSessionDescriptor(session);
  if (
    !canonical || typeof answer.sdp !== 'string' ||
    !answer.sdp.startsWith('v=0') || answer.sdp.length > 65536
  ) {
    throw new RangeError('Invalid versioned WebRTC answer');
  }
  const msg: SignalingMessage = { type: 'answer', sdp: answer.sdp, session: canonical };
  return `${window.location.origin}${window.location.pathname}#response=${compressAndEncode(msg)}`;
}

/** Validate a decoded untrusted manual SDP+ruleset without coercing old links. */
export function parseVersionedManualSignal(
  payload: unknown,
  expectedType: 'offer' | 'answer',
): { type: 'offer' | 'answer'; sdp: string; session: FlightSessionDescriptor } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  try {
    const obj = payload as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(obj);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (
      Object.keys(obj).length !== 3 ||
      !Object.hasOwn(obj, 'type') ||
      !Object.hasOwn(obj, 'sdp') ||
      !Object.hasOwn(obj, 'session') ||
      obj.type !== expectedType
    ) return null;
    if (typeof obj.sdp !== 'string' || !obj.sdp.startsWith('v=0') || obj.sdp.length > 65536) {
      return null;
    }
    const session = parseFlightSessionDescriptor(obj.session);
    if (!session) return null;
    return { type: expectedType, sdp: obj.sdp, session };
  } catch {
    return null;
  }
}

export function parseLinkPayload(
  hash: string,
): { type: string; payload: unknown } | null {
  const trimmed = hash.trim();
  if (!trimmed) return null;

  // Handle manual invite/response links
  const manualMatch = trimmed.match(/#?(invite|response)=([^?& \n]*)/);
  if (manualMatch) {
    try {
      const type = manualMatch[1]!;
      const payload = decodeAndDecompress(manualMatch[2]!);
      console.debug('[SIGNALING] Parsed manual link successfully, type:', type);
      return { type, payload };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.debug('[SIGNALING] Failed to parse manual link payload:', reason);
      return null;
    }
  }

  // Handle automated join links (e.g. #join=nostr:roomId)
  const autoMatch = trimmed.match(/#?join=([^:]+):([^?& \n]*)/);
  if (autoMatch) {
    const strategy = autoMatch[1]!;
    const roomId = autoMatch[2]!;
    console.debug(
      '[SIGNALING] Parsed auto join link successfully, strategy:',
      strategy,
      'roomId:',
      roomId,
    );
    return {
      type: 'auto_join',
      payload: { strategy, roomId },
    };
  }

  console.debug('[SIGNALING] Regex match failed for hash:', trimmed);
  return null;
}
