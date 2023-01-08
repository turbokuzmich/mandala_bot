import BaseComponent from "./base.js";
import { colorBlack } from "../constants.js";

export default class Text extends BaseComponent {
  _measure = null;
  _formattedText = null;

  text = "";
  color = colorBlack;

  get measure() {
    if (!this._measure) {
      const {
        lines: [measure],
      } = this.context.measureText(this.formattedText, Infinity);

      this._measure = measure;
    }

    return this._measure;
  }

  get formattedText() {
    if (!this._formattedText) {
      this._formattedText = `«${this.text}»`;
    }

    return this._formattedText;
  }

  constructor(context, text, color = colorBlack, animations = {}) {
    super(context, animations);

    this.text = text;
    this.color = color;
  }

  render() {
    super.render();

    this.context.save();

    this.context.translate(this.animate("x", 0), this.animate("y", 0));

    this.context.fillStyle = this.animateColorOpacity(this.color).rgb();
    this.context.fillText(this.formattedText, 0, -this.measure.y);

    this.context.restore();
  }
}
