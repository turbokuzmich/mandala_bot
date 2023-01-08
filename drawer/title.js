import BaseComponent from "./base.js";
import { resultTitle, colorBlack } from "../constants.js";

export default class Title extends BaseComponent {
  _measure = null;

  color = colorBlack;

  get measure() {
    if (!this._measure) {
      const {
        lines: [measure],
      } = this.context.measureText(resultTitle, Infinity);

      this._measure = measure;
    }

    return this._measure;
  }

  constructor(context, color = colorBlack, animations = {}) {
    super(context, animations);

    this.color = color;
  }

  render() {
    super.render();

    this.context.save();

    this.context.translate(this.animate("x", 0), this.animate("y", 0));

    this.context.fillStyle = this.animateColorOpacity(this.color).rgb();
    this.context.fillText(resultTitle, 0, -this.measure.y);

    this.context.restore();
  }
}
