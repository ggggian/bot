import { describe, expect, test } from "bun:test";
import { createWalletMenuModule } from "../src/handlers/wallet-menu";
import { createMemoryHoldMarkStore } from "../src/services/hold-marks";

const USER = 7_301;
const GROUP = -7_302;
const BALANCES =
  "Solana address 🔎\n\n<code>synthetic-wallet</code> (Tap to copy)\n\nSOL: <code>2</code> SOL";

const createModule = (telegramApiRoot: string) =>
  createWalletMenuModule({
    bot: { callbackQuery: () => undefined } as any,
    telegramApiRoot,
    holdMarks: createMemoryHoldMarkStore(),
    wallet: {
      connection: { rpcEndpoint: "synthetic-rpc" },
      getConnection() {
        return this.connection;
      },
      getBalance: async () => 2_000_000_000,
      peekCachedNativeBalance: () => undefined,
      getWalletTokenBalancePage: async () => ({
        tokenBalances: [],
        page: 0,
        pageCount: 1,
        heldMints: [],
        complete: true,
      }),
      peekCachedWalletTokenBalances: () => undefined,
      setCachedNativeBalance: () => {},
      setCachedWalletTokenBalances: () => {},
      clearCachedWalletData: () => {},
      onWalletCacheCleared: () => () => {},
      getKeyPair: () => ({ publicKey: { toBase58: () => "synthetic-wallet" } }),
      formatSolBalance: () => "2",
      formatTokenBalance: () => "0",
    } as any,
    getTokenManager: () => ({ getAllKnownTokensWithMetadata: () => [] }) as any,
    wrapCallbackHandler: (fn: any) => fn,
    rpcRateLimiter: { limiter: { consume: () => ({ allowed: true, resetInMs: 0 }) } as any },
  });

// The private context /balance builds when it is typed in a group.
const groupBalanceContext = () => {
  const calls: any[][] = [];
  const ctx: any = {
    from: { id: USER },
    chat: { id: String(USER), type: "private" },
    me: { id: 42 },
    __originChatId: GROUP,
    __originMessageId: 7_303,
    reply: async (...args: any[]) => {
      calls.push(["reply", ...args]);
      return { message_id: 7_304, chat: { id: USER } };
    },
    api: {
      sendMessage: async (...args: any[]) => {
        calls.push(["send", ...args]);
        return { message_id: 7_305, chat: { id: args[0] } };
      },
    },
  };
  return { ctx, calls };
};

describe("wallet menu group copy of /balance", () => {
  test("through the official Bot API, a /balance typed in a group also shows its copy there", async () => {
    const { ctx, calls } = groupBalanceContext();

    await createModule("https://api.telegram.org").showWalletUI(ctx);

    expect(
      calls.map(([kind, ...args]) => (kind === "reply" ? [kind, args[0]] : [kind, ...args])),
    ).toEqual([
      ["reply", BALANCES],
      [
        "send",
        GROUP,
        `${BALANCES}\n\n<i>The full wallet menu is in our private chat.</i>`,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_parameters: { message_id: 7_303, allow_sending_without_reply: true },
          ephemeral_message_parameters: { receiver_user_id: USER },
        },
      ],
    ]);
  });

  test("through another Bot API server, a /balance typed in a group gets only the private copy", async () => {
    const { ctx, calls } = groupBalanceContext();

    await createModule("https://synthetic-bot-api.example").showWalletUI(ctx);

    expect(calls.map(([kind, text]) => [kind, text])).toEqual([["reply", BALANCES]]);
  });
});
