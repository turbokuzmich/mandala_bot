export default class Background {
  context = null;
  rect = { x: 0, y: 0, width: 0, height: 0 };
  direction = { x1: 0, y1: 0, x2: 0, y2: 0 };
  colorStops = [];

  constructor(context, direction, rect, colorStops) {
    this.context = context;
    this.rect = { ...this.rect, ...rect };
    this.direction = { ...this.direction, ...direction };
    this.colorStops = colorStops;
  }

  render() {
    this.context.save();

    const { x1, y1, x2, y2 } = this.direction;
    const { x, y, width, height } = this.rect;

    const gradient = this.context.createLinearGradient(x1, y1, x2, y2);

    this.colorStops.forEach(({ at, color }) => {
      gradient.addColorStop(at, color);
    });

    this.context.fillStyle = gradient;
    this.context.fillRect(x, y, width, height);

    this.context.restore();
  }
}
