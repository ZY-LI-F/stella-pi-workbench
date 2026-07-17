import type { BoardState } from "../shared/kanban";

export interface BoardRepository {
  read(): Promise<BoardState>;
  update(transform: (current: BoardState) => BoardState): Promise<BoardState>;
}
