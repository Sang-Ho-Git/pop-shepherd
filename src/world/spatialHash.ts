/**
 * 5.4 공간 해시. 매 틱 적 위치로 다시 채우고, 반경 질의로 이웃 후보를 돌려준다.
 * 칸에 넣는 값은 enemies 배열의 인덱스다.
 */
export class SpatialHash {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
  }

  insert(index: number, x: number, y: number): void {
    (this.buckets[this.row(y) * this.cols + this.col(x)] as number[]).push(index);
  }

  /** (x, y)에서 radius 안에 걸칠 수 있는 칸의 인덱스를 out에 담는다. 거리 검사는 호출 쪽에서 한다. */
  query(x: number, y: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const c0 = this.col(x - radius);
    const c1 = this.col(x + radius);
    const r0 = this.row(y - radius);
    const r1 = this.row(y + radius);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets[r * this.cols + c] as number[];
        for (let i = 0; i < b.length; i++) out.push(b[i] as number);
      }
    }
    return out;
  }
}
