export class LayoutBlock {
  _size = null;

  context = null;
  content = null;
  alignment = "left";
  offset = { top: 0, right: 0, bottom: 0, left: 0 };

  get size() {
    if (!this._size) {
      this._size = {
        width:
          this.offset.left + this.content.measure.width + this.offset.right,
        height:
          this.offset.top + this.content.measure.height + this.offset.bottom,
      };
    }

    return this._size;
  }

  constructor(context, content, alignment = "left", offset = {}) {
    this.context = context;
    this.content = content;
    this.alignment = alignment;
    this.offset = { ...this.offset, ...offset };
  }

  setFrame(frame) {
    this.content.setFrame(frame);
  }

  getFramesCount() {
    return this.content.getFramesCount();
  }

  render() {
    this.content.render();
  }
}

export class Layout {
  _size = null;

  context = null;
  blocks = [];

  get size() {
    if (!this._size) {
      const blocksWidths = this.blocks.map((block) => block.size.width);
      const blocksHeights = this.blocks.map((block) => block.size.height);

      const width = Math.ceil(Math.max(...blocksWidths));
      const height = Math.ceil(
        blocksHeights.reduce((result, height) => result + height)
      );

      this._size = {
        width: Math.ceil(width / 2) * 2,
        height: Math.ceil(height / 2) * 2,
      };
    }

    return this._size;
  }

  constructor(context, blocks = []) {
    this.context = context;
    this.blocks = blocks;
  }

  setFrame(frame) {
    this.blocks.forEach((block) => {
      block.setFrame(frame);
    });
  }

  getFramesCount() {
    return Math.max(...this.blocks.map((block) => block.getFramesCount()));
  }

  appendBlock(block) {
    this._size = null;
    this.blocks = [...this.blocks, block];
  }

  render() {
    let topOffset = 0;

    for (const block of this.blocks) {
      this.context.save();

      const blockWidth = block.content.measure.width;
      const availableWidth =
        this.size.width - block.offset.left - block.offset.right;

      const leftOffset =
        block.alignment === "left"
          ? block.offset.left
          : block.alignment === "right"
          ? block.offset.left + availableWidth - blockWidth
          : block.offset.left + (availableWidth - blockWidth) / 2;

      this.context.translate(leftOffset, topOffset + block.offset.top);

      block.render();

      this.context.restore();

      topOffset += block.size.height;
    }
  }
}
