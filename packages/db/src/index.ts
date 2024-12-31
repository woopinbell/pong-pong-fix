import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type {
  ChatMessage,
  DashboardSummary,
  FriendSummary,
  AdminActionSummary,
  LeaderboardEntry,
  MatchMode,
  MatchSummary,
  PublicUser,
  SessionUser,
  TournamentMatchSummary,
  TournamentSummary,
  UserRole,
  UserStatus
} from "@pong-pong/shared";

type RawUser = {
  id: string;
  email: string | null;
  handle: string;
  display_name: string;
  avatar_key: string;
  role: UserRole;
  status: UserStatus;
  rating: number;
  wins: number;
  losses: number;
  is_npc: boolean;
};

export interface DevLoginInput {
  handle: string;
  displayName: string;
  email?: string | null;
}

export interface CreateWsTicketInput {
  userId: string;
  ticketHash: string;
  ttlSeconds: number;
}

export type SeedProfile = "development" | "demo";

type NpcSeed = {
  handle: string;
  displayName: string;
  rating: number;
  avatarKey: string;
};

const NPC_PLAYERS: NpcSeed[] = [
  { handle: "npc-rally-1100", displayName: "AI 랠리 1100", rating: 1100, avatarKey: "green" },
  { handle: "npc-block-1200", displayName: "AI 블록 1200", rating: 1200, avatarKey: "blue" },
  { handle: "npc-spin-1300", displayName: "AI 스핀 1300", rating: 1300, avatarKey: "amber" },
  { handle: "npc-smash-1400", displayName: "AI 스매시 1400", rating: 1400, avatarKey: "rose" }
];

export interface CreateMatchInput {
  mode: MatchMode;
  winnerId: string | null;
  loserId: string | null;
  scoreLeft: number;
  scoreRight: number;
}

export interface TournamentMatchRecord {
  id: string;
  tournamentId: string;
  round: "semifinal" | "final";
  slot: number;
  status: "pending" | "ready" | "running" | "finished";
  leftUserId: string | null;
  rightUserId: string | null;
  winnerId: string | null;
}

export interface AppRepository {
  close(): Promise<void>;
  ensureSeedData(profile?: SeedProfile): Promise<void>;
  upsertDevUser(input: DevLoginInput): Promise<SessionUser>;
  createSession(userId: string): Promise<string>;
  getSessionUser(token: string | undefined): Promise<SessionUser | null>;
  deleteSession(token: string | undefined): Promise<void>;
  createWsTicket(input: CreateWsTicketInput): Promise<void>;
  consumeWsTicket(ticketHash: string): Promise<SessionUser | null>;
  setUserRoleByHandle(handle: string, role: UserRole): Promise<PublicUser>;
  getUserById(id: string): Promise<PublicUser | null>;
  getUserByHandle(handle: string): Promise<PublicUser | null>;
  updateProfile(userId: string, input: { displayName?: string; avatarKey?: string }): Promise<SessionUser>;
  listOnlineUsers(): Promise<PublicUser[]>;
  listNpcOpponents(): Promise<PublicUser[]>;
  listLeaderboard(): Promise<LeaderboardEntry[]>;
  listRecentMatches(userId?: string): Promise<MatchSummary[]>;
  getDashboard(userId: string): Promise<DashboardSummary>;
  listFriends(userId: string): Promise<FriendSummary[]>;
  requestFriend(requesterId: string, addresseeHandle: string): Promise<FriendSummary>;
  acceptFriend(userId: string, friendshipId: string): Promise<FriendSummary>;
  createMatch(input: CreateMatchInput): Promise<string>;
  listLobbyChat(): Promise<ChatMessage[]>;
  createChatMessage(input: { scope: "lobby" | "match"; roomId?: string | null; senderId: string; body: string }): Promise<ChatMessage>;
  listTournaments(): Promise<TournamentSummary[]>;
  createTournament(input: { name: string; createdBy: string }): Promise<TournamentSummary>;
  joinTournament(tournamentId: string, userId: string): Promise<TournamentSummary>;
  getTournamentMatch(matchId: string): Promise<TournamentMatchRecord | null>;
  startTournamentMatch(matchId: string, roomId: string): Promise<void>;
  completeTournamentMatch(input: { tournamentMatchId: string; roomId: string; matchId: string; winnerId: string | null; scoreLeft: number; scoreRight: number }): Promise<TournamentSummary>;
  listAdminUsers(): Promise<PublicUser[]>;
  listAdminActions(): Promise<AdminActionSummary[]>;
  setUserBan(actorId: string, targetUserId: string, banned: boolean, reason: string): Promise<PublicUser>;
}

export function createPostgresRepository(databaseUrl: string): AppRepository {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
  return new PostgresRepository(db, pool);
}

export function createMemoryRepository(): AppRepository {
  return new MemoryRepository();
}

class PostgresRepository implements AppRepository {
  constructor(
    private readonly db: Kysely<any>,
    private readonly pool: Pool
  ) {}

  async close(): Promise<void> {
    await this.db.destroy();
    await this.pool.end().catch(() => undefined);
  }

  async ensureSeedData(profile: SeedProfile = "development"): Promise<void> {
    if (profile === "development") {
      const players: DevLoginInput[] = [
        { handle: "spin-doctor", displayName: "스핀닥터", email: "spin@pong.local" },
        { handle: "paddle-pro", displayName: "패들프로", email: "paddle@pong.local" },
        { handle: "net-ninja", displayName: "네트닌자", email: "net@pong.local" },
        { handle: "top-spin", displayName: "탑스핀", email: "top@pong.local" },
        { handle: "admin", displayName: "운영자", email: "admin@pong.local" }
      ];
      for (const player of players) {
        await this.upsertDevUser(player);
      }
    }
    for (const npc of NPC_PLAYERS) {
      await this.upsertNpc(npc);
    }
    if (profile === "development") {
      await sql`update users set role = 'admin', rating = 1680 where handle = 'admin'`.execute(this.db);
      await sql`update users set rating = 1723, wins = 32, losses = 11 where handle = 'spin-doctor'`.execute(this.db);
      await sql`update users set rating = 1640, wins = 24, losses = 13 where handle = 'paddle-pro'`.execute(this.db);
      await sql`update users set rating = 1512, wins = 18, losses = 15 where handle = 'net-ninja'`.execute(this.db);
      await sql`update users set rating = 1450, wins = 15, losses = 17 where handle = 'top-spin'`.execute(this.db);
    }
  }

  async upsertDevUser(input: DevLoginInput): Promise<SessionUser> {
    const handle = normalizeHandle(input.handle);
    const email = input.email ?? `${handle}@dev.pong-pong.local`;
    const displayName = input.displayName.trim() || handle;
    const result = await sql<RawUser>`
      insert into users (email, handle, display_name, avatar_key, role, is_npc)
      values (${email}, ${handle}, ${displayName}, ${avatarFor(handle)}, 'user', false)
      on conflict (handle) do update set
        email = excluded.email,
        display_name = excluded.display_name,
        role = 'user',
        is_npc = false
      returning *
    `.execute(this.db);
    return toSessionUser(firstRow(result));
  }

  private async upsertNpc(input: NpcSeed): Promise<void> {
    await sql`
      insert into users (email, handle, display_name, avatar_key, role, status, rating, wins, losses, is_npc)
      values (null, ${input.handle}, ${input.displayName}, ${input.avatarKey}, 'user', 'active', ${input.rating}, 0, 0, true)
      on conflict (handle) do update set
        display_name = excluded.display_name,
        avatar_key = excluded.avatar_key,
        status = 'active',
        rating = excluded.rating,
        is_npc = true
    `.execute(this.db);
  }

  async createSession(userId: string): Promise<string> {
    const token = randomUUID();
    await sql`
      insert into sessions (token, user_id, expires_at)
      values (${token}, ${userId}, now() + interval '14 days')
    `.execute(this.db);
    return token;
  }

  async getSessionUser(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const result = await sql<RawUser>`
      select u.*
      from sessions s
      join users u on u.id = s.user_id
      where s.token = ${token} and s.expires_at > now()
      limit 1
    `.execute(this.db);
    const user = result.rows[0];
    return user ? toSessionUser(user, true) : null;
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (!token) return;
    await sql`delete from sessions where token = ${token}`.execute(this.db);
  }

  async createWsTicket(input: CreateWsTicketInput): Promise<void> {
    assertWsTicketHash(input.ticketHash);
    assertTicketTtl(input.ttlSeconds);
    await sql`
      insert into ws_tickets (ticket_hash, user_id, expires_at)
      values (
        ${input.ticketHash},
        ${input.userId},
        now() + (${input.ttlSeconds} * interval '1 second')
      )
    `.execute(this.db);
  }

  async consumeWsTicket(ticketHash: string): Promise<SessionUser | null> {
    assertWsTicketHash(ticketHash);
    const result = await sql<RawUser>`
      with consumed as (
        delete from ws_tickets
        where ticket_hash = ${ticketHash}
        returning user_id, expires_at
      )
      select u.*
      from consumed c
      join users u on u.id = c.user_id
      where c.expires_at > now() and u.status = 'active'
      limit 1
    `.execute(this.db);
    return result.rows[0] ? toSessionUser(result.rows[0], true) : null;
  }

  async setUserRoleByHandle(handle: string, role: UserRole): Promise<PublicUser> {
    const result = await sql<RawUser>`
      update users
      set role = ${role}
      where handle = ${normalizeHandle(handle)} and is_npc = false
      returning *
    `.execute(this.db);
    if (!result.rows[0]) throw new Error("user not found");
    return toPublicUser(result.rows[0]);
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    const result = await sql<RawUser>`select * from users where id = ${id} limit 1`.execute(this.db);
    return result.rows[0] ? toPublicUser(result.rows[0]) : null;
  }

  async getUserByHandle(handle: string): Promise<PublicUser | null> {
    const result = await sql<RawUser>`select * from users where handle = ${normalizeHandle(handle)} limit 1`.execute(this.db);
    return result.rows[0] ? toPublicUser(result.rows[0]) : null;
  }

  async updateProfile(userId: string, input: { displayName?: string; avatarKey?: string }): Promise<SessionUser> {
    const current = await sql<RawUser>`select * from users where id = ${userId} limit 1`.execute(this.db);
    const user = firstRow(current);
    const result = await sql<RawUser>`
      update users
      set display_name = ${input.displayName ?? user.display_name},
          avatar_key = ${input.avatarKey ?? user.avatar_key}
      where id = ${userId}
      returning *
    `.execute(this.db);
    return toSessionUser(firstRow(result), true);
  }

  async listOnlineUsers(): Promise<PublicUser[]> {
    const result = await sql<RawUser>`select * from users where status = 'active' order by rating desc limit 12`.execute(this.db);
    return result.rows.map((row) => toPublicUser(row, true));
  }

  async listNpcOpponents(): Promise<PublicUser[]> {
    const result = await sql<RawUser>`select * from users where status = 'active' and is_npc = true order by rating asc`.execute(this.db);
    return result.rows.map((row) => toPublicUser(row, false));
  }

  async listLeaderboard(): Promise<LeaderboardEntry[]> {
    const result = await sql<RawUser>`select * from users order by rating desc, wins desc limit 20`.execute(this.db);
    return result.rows.map((row, index) => ({
      rank: index + 1,
      user: toPublicUser(row, false),
      winRate: percentage(row.wins, row.losses)
    }));
  }

  async listRecentMatches(userId?: string): Promise<MatchSummary[]> {
    const result = userId
      ? await sql<any>`
        select m.*, winner.handle as winner_handle, loser.handle as loser_handle
        from matches m
        left join users winner on winner.id = m.winner_id
        left join users loser on loser.id = m.loser_id
        where m.winner_id = ${userId} or m.loser_id = ${userId}
        order by m.ended_at desc
        limit 8
      `.execute(this.db)
      : await sql<any>`
        select m.*, winner.handle as winner_handle, loser.handle as loser_handle
        from matches m
        left join users winner on winner.id = m.winner_id
        left join users loser on loser.id = m.loser_id
        order by m.ended_at desc
        limit 8
      `.execute(this.db);
    return result.rows.map((row) => matchSummary(row, userId));
  }

  async getDashboard(userId: string): Promise<DashboardSummary> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error("user not found");
    const recentMatches = await this.listRecentMatches(userId);
    return {
      me: { ...user, email: null },
      recentMatches,
      winRate: percentage(user.wins, user.losses),
      bestStreak: bestWinningStreak(recentMatches)
    };
  }

  async listFriends(userId: string): Promise<FriendSummary[]> {
    const result = await sql<any>`
      select f.id as friendship_id, f.status as friendship_status, u.*
      from friendships f
      join users u on u.id = case when f.requester_id = ${userId} then f.addressee_id else f.requester_id end
      where f.requester_id = ${userId} or f.addressee_id = ${userId}
      order by f.updated_at desc
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.friendship_id,
      status: row.friendship_status,
      user: toPublicUser(row, true)
    }));
  }

  async requestFriend(requesterId: string, addresseeHandle: string): Promise<FriendSummary> {
    const addressee = await this.getUserByHandle(addresseeHandle);
    if (!addressee) throw new Error("friend not found");
    const result = await sql<any>`
      insert into friendships (requester_id, addressee_id, status)
      values (${requesterId}, ${addressee.id}, 'pending')
      on conflict (requester_id, addressee_id) do update set updated_at = now()
      returning id, status
    `.execute(this.db);
    return { id: firstRow(result).id, status: firstRow(result).status, user: addressee };
  }

  async acceptFriend(userId: string, friendshipId: string): Promise<FriendSummary> {
    await sql`update friendships set status = 'accepted', updated_at = now() where id = ${friendshipId} and addressee_id = ${userId}`.execute(this.db);
    const friends = await this.listFriends(userId);
    const found = friends.find((friend) => friend.id === friendshipId);
    if (!found) throw new Error("friendship not found");
    return found;
  }

  async createMatch(input: CreateMatchInput): Promise<string> {
    const result = await sql<{ id: string }>`
      insert into matches (mode, winner_id, loser_id, score_left, score_right, rating_delta)
      values (${input.mode}, ${input.winnerId}, ${input.loserId}, ${input.scoreLeft}, ${input.scoreRight}, 16)
      returning id
    `.execute(this.db);
    if (input.winnerId) {
      await sql`update users set wins = wins + 1, rating = rating + 16 where id = ${input.winnerId}`.execute(this.db);
    }
    if (input.loserId) {
      await sql`update users set losses = losses + 1, rating = greatest(800, rating - 12) where id = ${input.loserId}`.execute(this.db);
    }
    return firstRow(result).id;
  }

  async listLobbyChat(): Promise<ChatMessage[]> {
    const result = await sql<any>`
      select c.*, u.id as user_id, u.email, u.handle, u.display_name, u.avatar_key, u.role, u.status, u.rating, u.wins, u.losses, u.is_npc
      from chat_messages c
      join users u on u.id = c.sender_id
      where c.scope = 'lobby'
      order by c.created_at desc
      limit 20
    `.execute(this.db);
    return result.rows.reverse().map(chatRow);
  }

  async createChatMessage(input: { scope: "lobby" | "match"; roomId?: string | null; senderId: string; body: string }): Promise<ChatMessage> {
    const result = await sql<any>`
      insert into chat_messages (scope, room_id, sender_id, body)
      values (${input.scope}, ${input.roomId ?? null}, ${input.senderId}, ${input.body})
      returning *
    `.execute(this.db);
    const user = await this.getUserById(input.senderId);
    if (!user) throw new Error("chat sender not found");
    const row = firstRow(result);
    return {
      id: row.id,
      scope: row.scope,
      roomId: row.room_id,
      sender: user,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    const result = await sql<any>`
      select t.*, u.id as creator_id, u.email, u.handle, u.display_name, u.avatar_key, u.role, u.status as user_status, u.rating, u.wins, u.losses, u.is_npc
      from tournaments t
      join users u on u.id = t.created_by
      order by t.created_at desc
      limit 10
    `.execute(this.db);
    const summaries: TournamentSummary[] = [];
    for (const row of result.rows) {
      summaries.push(await this.tournamentFromRow(row));
    }
    return summaries;
  }

  async createTournament(input: { name: string; createdBy: string }): Promise<TournamentSummary> {
    const result = await sql<any>`
      insert into tournaments (name, created_by, capacity)
      values (${input.name}, ${input.createdBy}, 4)
      returning *
    `.execute(this.db);
    await this.joinTournament(firstRow(result).id, input.createdBy);
    const tournaments = await this.listTournaments();
    return tournaments.find((item) => item.id === firstRow(result).id) ?? tournaments[0];
  }

  async joinTournament(tournamentId: string, userId: string): Promise<TournamentSummary> {
    const count = await sql<{ count: string }>`select count(*)::text from tournament_entries where tournament_id = ${tournamentId}`.execute(this.db);
    const tournament = await sql<{ capacity: number; joined: boolean }>`
      select capacity, exists(select 1 from tournament_entries where tournament_id = ${tournamentId} and user_id = ${userId}) as joined
      from tournaments
      where id = ${tournamentId}
      limit 1
    `.execute(this.db);
    const tournamentRow = firstRow(tournament);
    if (!tournamentRow.joined && Number(firstRow(count).count) >= Number(tournamentRow.capacity)) {
      throw new Error("tournament full");
    }
    const seed = Number(firstRow(count).count) + 1;
    await sql`
      insert into tournament_entries (tournament_id, user_id, seed)
      values (${tournamentId}, ${userId}, ${seed})
      on conflict (tournament_id, user_id) do nothing
    `.execute(this.db);
    await sql`
      update tournaments
      set status = case when (select count(*) from tournament_entries where tournament_id = ${tournamentId}) >= capacity then 'running' else status end
      where id = ${tournamentId}
    `.execute(this.db);
    await this.ensureTournamentBracket(tournamentId);
    const tournaments = await this.listTournaments();
    const found = tournaments.find((item) => item.id === tournamentId);
    if (!found) throw new Error("tournament not found");
    return found;
  }

  async getTournamentMatch(matchId: string): Promise<TournamentMatchRecord | null> {
    const result = await sql<any>`select * from tournament_matches where id = ${matchId} limit 1`.execute(this.db);
    return result.rows[0] ? tournamentMatchRecord(result.rows[0]) : null;
  }

  async startTournamentMatch(matchId: string, roomId: string): Promise<void> {
    await sql`
      update tournament_matches
      set status = 'running', room_id = ${roomId}, updated_at = now()
      where id = ${matchId} and status in ('ready', 'running')
    `.execute(this.db);
  }

  async completeTournamentMatch(input: { tournamentMatchId: string; roomId: string; matchId: string; winnerId: string | null; scoreLeft: number; scoreRight: number }): Promise<TournamentSummary> {
    const updated = await sql<any>`
      update tournament_matches
      set status = 'finished',
          room_id = ${input.roomId},
          match_id = ${input.matchId},
          winner_id = ${input.winnerId},
          score_left = ${input.scoreLeft},
          score_right = ${input.scoreRight},
          updated_at = now()
      where id = ${input.tournamentMatchId}
      returning *
    `.execute(this.db);
    const row = firstRow(updated);
    if (row.round === "semifinal") {
      await this.ensureFinalMatch(row.tournament_id);
    } else {
      await sql`update tournaments set status = 'finished', winner_id = ${input.winnerId} where id = ${row.tournament_id}`.execute(this.db);
    }
    const tournaments = await this.listTournaments();
    const found = tournaments.find((item) => item.id === row.tournament_id);
    if (!found) throw new Error("tournament not found");
    return found;
  }

  async listAdminUsers(): Promise<PublicUser[]> {
    const result = await sql<RawUser>`select * from users order by created_at desc limit 50`.execute(this.db);
    return result.rows.map((row) => toPublicUser(row, true));
  }

  async listAdminActions(): Promise<AdminActionSummary[]> {
    const result = await sql<any>`
      select *
      from admin_actions
      order by created_at desc
      limit 30
    `.execute(this.db);
    return Promise.all(result.rows.map(async (row) => ({
      id: row.id,
      actor: row.actor_id ? await this.getUserById(row.actor_id) : null,
      target: row.target_user_id ? await this.getUserById(row.target_user_id) : null,
      action: row.action,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString()
    })));
  }

  async setUserBan(actorId: string, targetUserId: string, banned: boolean, reason: string): Promise<PublicUser> {
    const result = await sql<RawUser>`
      update users
      set status = ${banned ? "banned" : "active"}, banned_at = ${banned ? sql`now()` : null}
      where id = ${targetUserId}
      returning *
    `.execute(this.db);
    await sql`
      insert into admin_actions (actor_id, target_user_id, action, reason)
      values (${actorId}, ${targetUserId}, ${banned ? "ban" : "unban"}, ${reason})
    `.execute(this.db);
    return toPublicUser(firstRow(result));
  }

  private async tournamentFromRow(row: any): Promise<TournamentSummary> {
    const entries = await sql<RawUser>`
      select u.*
      from tournament_entries e
      join users u on u.id = e.user_id
      where e.tournament_id = ${row.id}
      order by e.seed asc
    `.execute(this.db);
    const matches = await sql<any>`
      select *
      from tournament_matches
      where tournament_id = ${row.id}
      order by case when round = 'semifinal' then 1 else 2 end, slot asc
    `.execute(this.db);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdBy: toPublicUser({
        id: row.creator_id,
        email: row.email,
        handle: row.handle,
        display_name: row.display_name,
        avatar_key: row.avatar_key,
        role: row.role,
        status: row.user_status,
        rating: row.rating,
        wins: row.wins,
        losses: row.losses,
        is_npc: row.is_npc
      }),
      playerCount: entries.rows.length,
      capacity: row.capacity,
      winner: row.winner_id ? await this.getUserById(row.winner_id) : null,
      entries: entries.rows.map((entry) => toPublicUser(entry, true)),
      matches: await Promise.all(matches.rows.map((match) => this.tournamentMatchFromRow(match)))
    };
  }

  private async ensureTournamentBracket(tournamentId: string): Promise<void> {
    const entries = await sql<{ user_id: string; seed: number }>`
      select user_id, seed
      from tournament_entries
      where tournament_id = ${tournamentId}
      order by seed asc
    `.execute(this.db);
    if (entries.rows.length < 4) return;
    await sql`
      insert into tournament_matches (tournament_id, round, slot, left_user_id, right_user_id, status)
      values
        (${tournamentId}, 'semifinal', 1, ${entries.rows[0].user_id}, ${entries.rows[3].user_id}, 'ready'),
        (${tournamentId}, 'semifinal', 2, ${entries.rows[1].user_id}, ${entries.rows[2].user_id}, 'ready')
      on conflict (tournament_id, round, slot) do nothing
    `.execute(this.db);
  }

  private async ensureFinalMatch(tournamentId: string): Promise<void> {
    const semis = await sql<{ winner_id: string; slot: number }>`
      select winner_id, slot
      from tournament_matches
      where tournament_id = ${tournamentId} and round = 'semifinal' and status = 'finished' and winner_id is not null
      order by slot asc
    `.execute(this.db);
    if (semis.rows.length < 2) return;
    await sql`
      insert into tournament_matches (tournament_id, round, slot, left_user_id, right_user_id, status)
      values (${tournamentId}, 'final', 1, ${semis.rows[0].winner_id}, ${semis.rows[1].winner_id}, 'ready')
      on conflict (tournament_id, round, slot) do nothing
    `.execute(this.db);
  }

  private async tournamentMatchFromRow(row: any): Promise<TournamentMatchSummary> {
    return {
      id: row.id,
      tournamentId: row.tournament_id,
      round: row.round,
      slot: Number(row.slot),
      status: row.status,
      left: row.left_user_id ? await this.getUserById(row.left_user_id) : null,
      right: row.right_user_id ? await this.getUserById(row.right_user_id) : null,
      winner: row.winner_id ? await this.getUserById(row.winner_id) : null,
      scoreLeft: row.score_left == null ? null : Number(row.score_left),
      scoreRight: row.score_right == null ? null : Number(row.score_right),
      roomId: row.room_id,
      matchId: row.match_id
    };
  }
}

class MemoryRepository implements AppRepository {
  private readonly users = new Map<string, RawUser>();
  private readonly sessions = new Map<string, string>();
  private readonly wsTickets = new Map<string, { userId: string; expiresAt: number }>();
  private readonly matches: Array<any> = [];
  private readonly chats: ChatMessage[] = [];
  private readonly friendships: FriendSummary[] = [];
  private readonly tournaments: TournamentSummary[] = [];
  private readonly adminActions: AdminActionSummary[] = [];

  async close(): Promise<void> {}

  async ensureSeedData(profile: SeedProfile = "development"): Promise<void> {
    if (profile === "development") {
      for (const player of [
        { handle: "spin-doctor", displayName: "스핀닥터", email: "spin@pong.local" },
        { handle: "paddle-pro", displayName: "패들프로", email: "paddle@pong.local" },
        { handle: "net-ninja", displayName: "네트닌자", email: "net@pong.local" },
        { handle: "admin", displayName: "운영자", email: "admin@pong.local" }
      ]) {
        await this.upsertDevUser(player);
      }
      const admin = [...this.users.values()].find((user) => user.handle === "admin");
      if (admin) {
        admin.role = "admin";
        admin.rating = 1680;
      }
    }
    for (const npc of NPC_PLAYERS) {
      const existing = [...this.users.values()].find((user) => user.handle === npc.handle);
      const user: RawUser = existing ?? {
        id: randomUUID(),
        email: null,
        handle: npc.handle,
        display_name: npc.displayName,
        avatar_key: npc.avatarKey,
        role: "user",
        status: "active",
        rating: npc.rating,
        wins: 0,
        losses: 0,
        is_npc: true
      };
      user.display_name = npc.displayName;
      user.avatar_key = npc.avatarKey;
      user.rating = npc.rating;
      user.status = "active";
      user.is_npc = true;
      this.users.set(user.id, user);
    }
  }

  async upsertDevUser(input: DevLoginInput): Promise<SessionUser> {
    const handle = normalizeHandle(input.handle);
    const existing = [...this.users.values()].find((user) => user.handle === handle);
    const user: RawUser = existing ?? {
      id: randomUUID(),
      email: input.email ?? `${handle}@dev.pong-pong.local`,
      handle,
      display_name: input.displayName || handle,
      avatar_key: avatarFor(handle),
      role: "user",
      status: "active",
      rating: 1200,
      wins: 0,
      losses: 0,
      is_npc: false
    };
    user.display_name = input.displayName || user.display_name;
    user.email = input.email ?? user.email;
    user.role = "user";
    user.is_npc = false;
    this.users.set(user.id, user);
    return toSessionUser(user, true);
  }

  async createSession(userId: string): Promise<string> {
    const token = randomUUID();
    this.sessions.set(token, userId);
    return token;
  }

  async getSessionUser(token: string | undefined): Promise<SessionUser | null> {
    const userId = token ? this.sessions.get(token) : undefined;
    const user = userId ? this.users.get(userId) : undefined;
    return user ? toSessionUser(user, true) : null;
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (token) this.sessions.delete(token);
  }

  async createWsTicket(input: CreateWsTicketInput): Promise<void> {
    assertWsTicketHash(input.ticketHash);
    assertTicketTtl(input.ttlSeconds);
    this.wsTickets.set(input.ticketHash, {
      userId: input.userId,
      expiresAt: Date.now() + input.ttlSeconds * 1_000
    });
  }

  async consumeWsTicket(ticketHash: string): Promise<SessionUser | null> {
    assertWsTicketHash(ticketHash);
    const ticket = this.wsTickets.get(ticketHash);
    if (!ticket) return null;
    this.wsTickets.delete(ticketHash);
    const user = this.users.get(ticket.userId);
    if (!user || ticket.expiresAt <= Date.now() || user.status !== "active") return null;
    return toSessionUser(user, true);
  }

  async setUserRoleByHandle(handle: string, role: UserRole): Promise<PublicUser> {
    const user = [...this.users.values()].find((item) => item.handle === normalizeHandle(handle) && !item.is_npc);
    if (!user) throw new Error("user not found");
    user.role = role;
    return toPublicUser(user, true);
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    const user = this.users.get(id);
    return user ? toPublicUser(user, true) : null;
  }

  async getUserByHandle(handle: string): Promise<PublicUser | null> {
    const user = [...this.users.values()].find((item) => item.handle === normalizeHandle(handle));
    return user ? toPublicUser(user, true) : null;
  }

  async updateProfile(userId: string, input: { displayName?: string; avatarKey?: string }): Promise<SessionUser> {
    const user = this.users.get(userId);
    if (!user) throw new Error("user not found");
    user.display_name = input.displayName ?? user.display_name;
    user.avatar_key = input.avatarKey ?? user.avatar_key;
    return toSessionUser(user, true);
  }

  async listOnlineUsers(): Promise<PublicUser[]> {
    return [...this.users.values()].sort((a, b) => b.rating - a.rating).map((user) => toPublicUser(user, true));
  }

  async listNpcOpponents(): Promise<PublicUser[]> {
    return [...this.users.values()]
      .filter((user) => user.is_npc && user.status === "active")
      .sort((a, b) => a.rating - b.rating)
      .map((user) => toPublicUser(user, false));
  }

  async listLeaderboard(): Promise<LeaderboardEntry[]> {
    return [...this.users.values()]
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
      .map((user, index) => ({ rank: index + 1, user: toPublicUser(user, false), winRate: percentage(user.wins, user.losses) }));
  }

  async listRecentMatches(userId?: string): Promise<MatchSummary[]> {
    return this.matches
      .filter((match) => !userId || match.winnerId === userId || match.loserId === userId)
      .slice(-8)
      .reverse()
      .map((match) => matchSummary(match, userId));
  }

  async getDashboard(userId: string): Promise<DashboardSummary> {
    const user = await this.getUserById(userId);
    if (!user) throw new Error("user not found");
    const recentMatches = await this.listRecentMatches(userId);
    return {
      me: { ...user, email: null },
      recentMatches,
      winRate: percentage(user.wins, user.losses),
      bestStreak: bestWinningStreak(recentMatches)
    };
  }

  async listFriends(): Promise<FriendSummary[]> {
    return this.friendships;
  }

  async requestFriend(requesterId: string, addresseeHandle: string): Promise<FriendSummary> {
    const user = await this.getUserByHandle(addresseeHandle);
    if (!user) throw new Error("friend not found");
    const friend = { id: randomUUID(), user, status: "pending" as const };
    this.friendships.push(friend);
    return friend;
  }

  async acceptFriend(_userId: string, friendshipId: string): Promise<FriendSummary> {
    const friend = this.friendships.find((item) => item.id === friendshipId);
    if (!friend) throw new Error("friendship not found");
    friend.status = "accepted";
    return friend;
  }

  async createMatch(input: CreateMatchInput): Promise<string> {
    const id = randomUUID();
    this.matches.push({ ...input, id, ended_at: new Date().toISOString() });
    if (input.winnerId) {
      const winner = this.users.get(input.winnerId);
      if (winner) {
        winner.wins += 1;
        winner.rating += 16;
      }
    }
    if (input.loserId) {
      const loser = this.users.get(input.loserId);
      if (loser) {
        loser.losses += 1;
        loser.rating -= 12;
      }
    }
    return id;
  }

  async listLobbyChat(): Promise<ChatMessage[]> {
    return this.chats.filter((chat) => chat.scope === "lobby").slice(-20);
  }

  async createChatMessage(input: { scope: "lobby" | "match"; roomId?: string | null; senderId: string; body: string }): Promise<ChatMessage> {
    const sender = await this.getUserById(input.senderId);
    if (!sender) throw new Error("chat sender not found");
    const message: ChatMessage = {
      id: randomUUID(),
      scope: input.scope,
      roomId: input.roomId ?? null,
      sender,
      body: input.body,
      createdAt: new Date().toISOString()
    };
    this.chats.push(message);
    return message;
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    return this.tournaments;
  }

  async createTournament(input: { name: string; createdBy: string }): Promise<TournamentSummary> {
    const creator = await this.getUserById(input.createdBy);
    if (!creator) throw new Error("creator not found");
    const tournament: TournamentSummary = {
      id: randomUUID(),
      name: input.name,
      status: "open",
      createdBy: creator,
      playerCount: 1,
      capacity: 4,
      winner: null,
      entries: [creator],
      matches: []
    };
    this.tournaments.unshift(tournament);
    return tournament;
  }

  async joinTournament(tournamentId: string, userId: string): Promise<TournamentSummary> {
    const tournament = this.tournaments.find((item) => item.id === tournamentId);
    const user = await this.getUserById(userId);
    if (!tournament || !user) throw new Error("tournament not found");
    const alreadyJoined = tournament.entries.some((entry) => entry.id === user.id);
    if (!alreadyJoined && tournament.entries.length >= tournament.capacity) {
      throw new Error("tournament full");
    }
    if (!alreadyJoined) {
      tournament.entries.push(user);
    }
    tournament.playerCount = tournament.entries.length;
    tournament.status = tournament.playerCount >= tournament.capacity ? "running" : "open";
    this.ensureMemoryBracket(tournament);
    return tournament;
  }

  async getTournamentMatch(matchId: string): Promise<TournamentMatchRecord | null> {
    const match = this.findTournamentMatch(matchId)?.match;
    if (!match) return null;
    return {
      id: match.id,
      tournamentId: match.tournamentId,
      round: match.round,
      slot: match.slot,
      status: match.status,
      leftUserId: match.left?.id ?? null,
      rightUserId: match.right?.id ?? null,
      winnerId: match.winner?.id ?? null
    };
  }

  async startTournamentMatch(matchId: string, roomId: string): Promise<void> {
    const found = this.findTournamentMatch(matchId);
    if (!found) throw new Error("tournament match not found");
    found.match.status = "running";
    found.match.roomId = roomId;
  }

  async completeTournamentMatch(input: { tournamentMatchId: string; roomId: string; matchId: string; winnerId: string | null; scoreLeft: number; scoreRight: number }): Promise<TournamentSummary> {
    const found = this.findTournamentMatch(input.tournamentMatchId);
    if (!found) throw new Error("tournament match not found");
    const winner = input.winnerId ? await this.getUserById(input.winnerId) : null;
    found.match.status = "finished";
    found.match.roomId = input.roomId;
    found.match.matchId = input.matchId;
    found.match.winner = winner;
    found.match.scoreLeft = input.scoreLeft;
    found.match.scoreRight = input.scoreRight;
    if (found.match.round === "semifinal") {
      this.ensureMemoryFinal(found.tournament);
    } else {
      found.tournament.status = "finished";
      found.tournament.winner = winner;
    }
    return found.tournament;
  }

  async listAdminUsers(): Promise<PublicUser[]> {
    return this.listOnlineUsers();
  }

  async listAdminActions(): Promise<AdminActionSummary[]> {
    return this.adminActions;
  }

  async setUserBan(actorId: string, targetUserId: string, banned: boolean, reason: string): Promise<PublicUser> {
    const user = this.users.get(targetUserId);
    if (!user) throw new Error("user not found");
    user.status = banned ? "banned" : "active";
    const actor = await this.getUserById(actorId);
    const target = toPublicUser(user, true);
    this.adminActions.unshift({
      id: randomUUID(),
      actor,
      target,
      action: banned ? "ban" : "unban",
      reason,
      createdAt: new Date().toISOString()
    });
    return target;
  }

  private ensureMemoryBracket(tournament: TournamentSummary): void {
    if (tournament.entries.length < tournament.capacity || tournament.matches.some((match) => match.round === "semifinal")) return;
    tournament.matches.push(
      memoryTournamentMatch(tournament.id, "semifinal", 1, tournament.entries[0], tournament.entries[3]),
      memoryTournamentMatch(tournament.id, "semifinal", 2, tournament.entries[1], tournament.entries[2])
    );
  }

  private ensureMemoryFinal(tournament: TournamentSummary): void {
    if (tournament.matches.some((match) => match.round === "final")) return;
    const semis = tournament.matches.filter((match) => match.round === "semifinal" && match.status === "finished" && match.winner).sort((a, b) => a.slot - b.slot);
    if (semis.length < 2) return;
    tournament.matches.push(memoryTournamentMatch(tournament.id, "final", 1, semis[0].winner, semis[1].winner));
  }

  private findTournamentMatch(matchId: string): { tournament: TournamentSummary; match: TournamentMatchSummary } | null {
    for (const tournament of this.tournaments) {
      const match = tournament.matches.find((item) => item.id === matchId);
      if (match) return { tournament, match };
    }
    return null;
  }
}

function firstRow<T>(result: { rows: T[] }): T {
  const row = result.rows[0];
  if (!row) throw new Error("expected database row");
  return row;
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "player";
}

function assertWsTicketHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("invalid websocket ticket hash");
  }
}

function assertTicketTtl(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("invalid websocket ticket ttl");
  }
}

function avatarFor(handle: string): string {
  const avatars = ["blue", "green", "amber", "violet", "rose"];
  return avatars[Math.abs([...handle].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % avatars.length];
}

function toPublicUser(row: RawUser, online = false): PublicUser {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    role: row.role,
    status: row.status,
    rating: Number(row.rating),
    wins: Number(row.wins),
    losses: Number(row.losses),
    online,
    isNpc: Boolean(row.is_npc)
  };
}

function toSessionUser(row: RawUser, online = false): SessionUser {
  return { ...toPublicUser(row, online), email: row.email };
}

function percentage(wins: number, losses: number): number {
  const total = Number(wins) + Number(losses);
  if (total === 0) return 0;
  return Math.round((Number(wins) / total) * 1000) / 10;
}

function bestWinningStreak(matches: MatchSummary[]): number {
  let best = 0;
  let current = 0;
  for (const match of [...matches].reverse()) {
    if (match.result === "win") {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function matchSummary(row: any, userId?: string): MatchSummary {
  const won = userId ? row.winner_id === userId || row.winnerId === userId : true;
  return {
    id: row.id,
    mode: row.mode,
    opponentHandle: won ? row.loser_handle ?? "AI" : row.winner_handle ?? "AI",
    result: won ? "win" : "loss",
    scoreLeft: Number(row.score_left ?? row.scoreLeft),
    scoreRight: Number(row.score_right ?? row.scoreRight),
    ratingDelta: won ? Number(row.rating_delta ?? 16) : -12,
    endedAt: new Date(row.ended_at ?? row.endedAt ?? Date.now()).toISOString()
  };
}

function tournamentMatchRecord(row: any): TournamentMatchRecord {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    round: row.round,
    slot: Number(row.slot),
    status: row.status,
    leftUserId: row.left_user_id,
    rightUserId: row.right_user_id,
    winnerId: row.winner_id
  };
}

function memoryTournamentMatch(tournamentId: string, round: "semifinal" | "final", slot: number, left: PublicUser | null, right: PublicUser | null): TournamentMatchSummary {
  return {
    id: randomUUID(),
    tournamentId,
    round,
    slot,
    status: "ready",
    left,
    right,
    winner: null,
    scoreLeft: null,
    scoreRight: null,
    roomId: null,
    matchId: null
  };
}

function chatRow(row: any): ChatMessage {
  return {
    id: row.id,
    scope: row.scope,
    roomId: row.room_id,
    sender: toPublicUser({
      id: row.user_id,
      email: row.email,
      handle: row.handle,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      role: row.role,
      status: row.status,
      rating: row.rating,
      wins: row.wins,
      losses: row.losses,
      is_npc: row.is_npc
    }),
    body: row.body,
    createdAt: new Date(row.created_at).toISOString()
  };
}
