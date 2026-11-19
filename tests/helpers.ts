import { createGame, rebuildGrid, step } from "../src/core/game.ts";
import { NO_INPUT } from "../src/core/types.ts";
import type { Color, Enemy, Game, GameEvent, Input, WeaponInstance } from "../src/core/types.ts";
import { character, ENEMIES } from "../src/data/index.ts";
import { spawnEnemy } from "../src/combat/spawner.ts";

/** 소환 없는 빈 아레나. 플레이어는 가운데(1280, 720)에 서 있다. */
export function emptyGame(opts: { weapons?: WeaponInstance[]; characterId?: string; seed?: number } = {}): Game {
  return createGame({
    seed: opts.seed ?? 1,
    character: character(opts.characterId ?? "shepherd"),
    enemyDefs: ENEMIES,
    stage: null,
    weapons: opts.weapons ?? [],
  });
}

/** 적 하나를 놓는다. 기본은 움직이지 않는 젤리 (추적 속도 0) — 규칙만 따로 보기 위해서다. */
export function put(g: Game, color: Color, x: number, y: number, opts: { kind?: string; moving?: boolean } = {}): Enemy {
  const e = spawnEnemy(g, opts.kind ?? (color === "gray" ? "gray" : "jelly"), color, x, y);
  if (!opts.moving) e.speed = 0;
  return e;
}

/** n틱 진행하고 그동안 나온 이벤트를 모두 돌려준다. */
export function run(g: Game, ticks: number, input: Input = NO_INPUT): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(g, input);
    all.push(...g.events);
  }
  return all;
}

export function pops(events: GameEvent[]): Extract<GameEvent, { type: "pop" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "pop" }> => e.type === "pop");
}

export function alive(g: Game, e: Enemy): boolean {
  return g.enemies.includes(e) && !e.dead;
}

export { rebuildGrid };
