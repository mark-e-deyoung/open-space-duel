import { TEMPORAL_CONFIG } from '../engine/state';
import { NetworkMessage } from './sync';

export class WebRTCConnection {
  public peerConnection: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;

  public onConnectionStateChange?: (state: string) => void;
  public onMessage?: (data: NetworkMessage) => void;
  public onConnected?: () => void;
  public onStatus?: (status: string) => void;

  constructor(lanOnly: boolean = false) {
    const config: RTCConfiguration = {};
    if (!lanOnly) {
      config.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onconnectionstatechange = () => {
      if (this.onConnectionStateChange && this.peerConnection) {
        this.onConnectionStateChange(this.peerConnection.connectionState);
      }
    };
  }

  // Called by Host
  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection closed');
    this.dataChannel = this.peerConnection.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    this.setupDataChannel(this.dataChannel);

    this.onStatus?.('GATHERING LOCAL PEERS');
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    await this.waitForIceGathering();

    return this.peerConnection.localDescription!;
  }

  // Called by Guest
  public async handleOfferAndCreateAnswer(offerSdp: string): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection closed');
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    this.onStatus?.('GATHERING REMOTE PEERS');
    await this.peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await this.waitForIceGathering();

    return this.peerConnection.localDescription!;
  }

  private async waitForIceGathering(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.peerConnection || this.peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, TEMPORAL_CONFIG.ICE_GATHERING_TIMEOUT);

      const checkState = () => {
        if (this.peerConnection && this.peerConnection.iceGatheringState === 'complete') {
          cleanup();
          resolve();
        }
      };

      const checkCandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate === null) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.peerConnection) {
          this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
          this.peerConnection.removeEventListener('icecandidate', checkCandidate);
        }
      };

      this.peerConnection.addEventListener('icegatheringstatechange', checkState);
      this.peerConnection.addEventListener('icecandidate', checkCandidate);
    });
  }

  // Called by Host after receiving guest's answer
  public async handleAnswer(answerSdp: string): Promise<void> {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      if (this.onConnected) this.onConnected();
    };
    channel.onmessage = (event) => {
      if (this.onMessage) {
        try {
          const parsed = JSON.parse(event.data);
          this.onMessage(parsed);
        } catch (e) {
          console.warn('Failed to parse WebRTC message', e);
        }
      }
    };
  }

  public sendMessage(msg: NetworkMessage) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(msg));
    }
  }

  public close() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}
