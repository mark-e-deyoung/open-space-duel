export class SideArt {
  private leftCanvas: HTMLCanvasElement;
  private rightCanvas: HTMLCanvasElement;
  private leftCtx: CanvasRenderingContext2D;
  private rightCtx: CanvasRenderingContext2D;
  private gameCanvas: HTMLCanvasElement;

  constructor(
    left: HTMLCanvasElement,
    right: HTMLCanvasElement,
    game: HTMLCanvasElement,
  ) {
    this.leftCanvas = left;
    this.rightCanvas = right;
    this.gameCanvas = game;
    this.leftCtx = left.getContext('2d')!;
    this.rightCtx = right.getContext('2d')!;

    // Smooth transition for opacity changes (mobile landscape fade)
    left.style.transition = 'opacity 0.3s ease';
    right.style.transition = 'opacity 0.3s ease';

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  public resize() {
    const gameRect = this.gameCanvas.getBoundingClientRect();
    const sideWidth = gameRect.left;
    const isPortrait = window.innerHeight > window.innerWidth;
    const isTouchDevice =
      'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Hide in mobile portrait and in any layout without usable side gutters.
    if ((isTouchDevice && isPortrait) || sideWidth < 80) {
      this.leftCanvas.style.display = 'none';
      this.rightCanvas.style.display = 'none';
      return;
    } else {
      this.leftCanvas.style.display = 'block';
      this.rightCanvas.style.display = 'block';
    }

    // On touch devices in landscape, fade side art so controls are visible
    const opacity = isTouchDevice && !isPortrait ? '0.25' : '1.0';
    this.leftCanvas.style.opacity = opacity;
    this.rightCanvas.style.opacity = opacity;

    this.leftCanvas.width = sideWidth;
    this.leftCanvas.height = window.innerHeight;
    this.rightCanvas.width = sideWidth;
    this.rightCanvas.height = window.innerHeight;

    this.render();
  }

  private render() {
    this.drawSide(
      this.leftCtx,
      this.leftCanvas.width,
      this.leftCanvas.height,
      true,
    );
    this.drawSide(
      this.rightCtx,
      this.rightCanvas.width,
      this.rightCanvas.height,
      false,
    );
  }

  private drawSide(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    isLeft: boolean,
  ) {
    if (width <= 0) return;

    ctx.clearRect(0, 0, width, height);

    // Background gradient for that 80s arcade cabinet feel
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    if (isLeft) {
      grad.addColorStop(0, '#050505');
      grad.addColorStop(1, '#000');
    } else {
      grad.addColorStop(0, '#000');
      grad.addColorStop(1, '#050505');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Grid lines (retro perspective feel)
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    for (let i = 0; i < height; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    // Decorate with game-style vector graphics
    ctx.save();

    // Random stars
    ctx.fillStyle = '#444';
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.fillRect(x, y, 1, 1);
    }

    // Large decorative elements
    const centerX = width / 2;

    // Draw a large ship silhouette
    ctx.translate(centerX, height * 0.25);
    ctx.scale(3, 3);
    ctx.rotate(isLeft ? Math.PI / 4 : -Math.PI / 4);
    this.drawVectorShip(ctx, isLeft ? '#ff00ff' : '#00ffcc');
    ctx.restore();

    // Draw some asteroids
    ctx.save();
    ctx.translate(isLeft ? width * 0.7 : width * 0.3, height * 0.7);
    ctx.scale(2, 2);
    this.drawVectorAsteroid(ctx, '#ffaa00');
    ctx.restore();

    ctx.save();
    ctx.translate(centerX, height * 0.5);
    ctx.scale(1.5, 1.5);
    this.drawVectorSaucer(ctx, '#ff3300');
    ctx.restore();
  }

  private drawVectorShip(ctx: CanvasRenderingContext2D, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, -8);
    ctx.closePath();
    ctx.stroke();

    // Inner line for "vector" look
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-5, 4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  private drawVectorAsteroid(ctx: CanvasRenderingContext2D, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const r = 15 + Math.random() * 5;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  private drawVectorSaucer(ctx: CanvasRenderingContext2D, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 6, 0, 0, Math.PI * 2);
    ctx.moveTo(-8, -4);
    ctx.lineTo(8, -4);
    ctx.stroke();
  }
}
