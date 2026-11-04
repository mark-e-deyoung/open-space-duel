import { fromUint8Array, toUint8Array } from 'js-base64';
import { strToU8, zlibSync, unzlibSync, strFromU8 } from 'fflate';

export interface SignalingMessage {
  type: 'offer' | 'answer';
  sdp: string;
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
