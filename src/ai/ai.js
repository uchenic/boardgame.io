/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { createGameReducer } from '../core/reducer';
import { alea } from '../core/random.alea';

/**
 * Simulates the game till the end.
 *
 * @param {...object} game - The game object.
 * @param {...object} bots - An array of bots.
 * @param {...object} state - The game state to start from.
 */
export function Simulate({ game, bots, state }) {
  const reducer = createGameReducer({ game, numPlayers: state.ctx.numPlayers });

  let metadata = null;
  while (
    state.ctx.gameover === undefined &&
    state.ctx.actionPlayers.length > 0
  ) {
    const playerID = state.ctx.actionPlayers[0];
    const bot = bots[playerID];
    const t = bot.play(state);
    metadata = t.metadata;
    state = reducer(state, t.action);
  }

  return { state, metadata };
}

/**
 * Steps forward one move.
 *
 * @param {...object} game - The game object.
 * @param {...object} bots - An array of bots.
 * @param {...object} state - The game state to start from.
 */
export function Step({ game, bots, state }) {
  const reducer = createGameReducer({ game, numPlayers: state.ctx.numPlayers });

  let metadata = null;
  if (state.ctx.gameover === undefined && state.ctx.actionPlayers.length > 0) {
    const playerID = state.ctx.actionPlayers[0];
    const bot = bots[playerID];
    const t = bot.play(state);
    metadata = t.metadata;
    state = reducer(state, t.action);
  }

  return { state, metadata };
}

export class Bot {
  constructor({ next, playerID, seed }) {
    this.next = next;
    this.playerID = playerID;
    this.seed = seed;
  }

  random(arg) {
    let number;

    if (this.seed !== undefined) {
      let r = null;
      if (this.prngstate) {
        r = new alea('', { state: this.prngstate });
      } else {
        r = new alea(this.seed, { state: true });
      }

      number = r();
      this.prngstate = r.state();
    } else {
      number = Math.random();
    }

    if (arg) {
      if (arg.length) {
        const id = Math.floor(number * arg.length);
        return arg[id];
      } else {
        return Math.floor(number * arg);
      }
    }

    return number;
  }
}

export class RandomBot extends Bot {
  play({ G, ctx }) {
    const moves = this.next(G, ctx, this.playerID);
    return { action: this.random(moves) };
  }
}

export class MCTSBot extends Bot {
  constructor({ game, next, playerID, seed, iterations }) {
    super({ next, playerID, seed });
    this.iterations = iterations || 500;
    this.reducer = createGameReducer({ game });
  }

  createNode({ state, parentAction, parent, playerID }) {
    const { G, ctx } = state;

    let actions = [];

    if (playerID !== undefined) {
      actions = this.next(G, ctx, playerID);
    } else {
      for (let playerID of ctx.actionPlayers) {
        actions = actions.concat(this.next(G, ctx, playerID));
      }
    }

    return {
      // Game state at this node.
      state,
      // Parent of the node.
      parent,
      // Move used to get to this node.
      parentAction,
      // Unexplored actions.
      actions,
      // Children of the node.
      children: [],
      // Number of simulations that pass through this node.
      visits: 0,
      // Number of wins for this node.
      value: 0,
    };
  }

  select(node) {
    // This node has unvisited children.
    if (node.actions.length > 0) {
      return node;
    }

    // This is a terminal node.
    if (node.children.length == 0) {
      return node;
    }

    let selectedChild = null;
    let best = 0.0;

    for (const child of node.children) {
      const uct =
        child.value / child.visits +
        Math.sqrt(2 * Math.log(node.visits) / child.visits);
      if (selectedChild == null || uct > best) {
        best = uct;
        selectedChild = child;
      }
    }

    return this.select(selectedChild);
  }

  expand(node) {
    const actions = node.actions;

    if (actions.length == 0 || node.state.ctx.gameover !== undefined) {
      return node;
    }

    const id = this.random(actions.length);
    const action = actions[id];
    node.actions.splice(id, 1);
    const childState = this.reducer(node.state, action);
    const childNode = this.createNode({
      state: childState,
      parentAction: action,
      parent: node,
    });
    node.children.push(childNode);
    return childNode;
  }

  playout(node) {
    let state = node.state;

    while (state.ctx.gameover === undefined) {
      const { G, ctx } = state;
      const moves = this.next(G, ctx, ctx.actionPlayers[0]);
      const id = this.random(moves.length);
      const childState = this.reducer(state, moves[id]);
      state = childState;
    }

    return state.ctx.gameover;
  }

  backpropagate(node, result) {
    node.visits++;

    if (result.draw === true) {
      node.value += 0.5;
    }

    if (
      node.parentAction &&
      result.winner === node.parentAction.payload.playerID
    ) {
      node.value++;
    }

    if (node.parent) {
      this.backpropagate(node.parent, result);
    }
  }

  play(state) {
    const root = this.createNode({ state, playerID: this.playerID });

    for (let i = 0; i < this.iterations; i++) {
      const leaf = this.select(root);
      const child = this.expand(leaf);
      const result = this.playout(child);
      this.backpropagate(child, result);
    }

    let selectedChild = null;
    for (const child of root.children) {
      if (selectedChild == null || child.visits > selectedChild.visits) {
        selectedChild = child;
      }
    }

    return {
      action: selectedChild.parentAction,
      metadata: root,
    };
  }
}
