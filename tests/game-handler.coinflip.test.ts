import { describe, expect, test } from "bun:test";
import { handleCoinflipCommand } from "../src/handlers/game";
import { createTelegramContext } from "./helpers/fixtures";

describe("game handler: coinflip command", () => {
  test("allows game creation in private chat (forced public)", async () => {
    const ctx: any = createTelegramContext("/cf 10", "private");
    const interactiveCalls: any[] = [];
    const commandCalls: any[] = [];

    const deps: any = {
      isGroupChat: () => false,
      showInteractiveSetup: async () => {
        interactiveCalls.push(true);
      },
      createGameViaCommand: async () => {
        commandCalls.push(true);
      },
      resolveTokenOverride: async () => null,
    };

    await handleCoinflipCommand(ctx, deps);

    // DM games are now allowed - should proceed to command handler
    expect(ctx.__calls.length).toBe(0);
    expect(interactiveCalls.length).toBe(0);
    expect(commandCalls.length).toBe(1);
  });

  test("no args opens interactive setup", async () => {
    const ctx: any = createTelegramContext("/cf");
    const interactiveCalls: any[] = [];
    const commandCalls: any[] = [];

    const deps: any = {
      isGroupChat: () => true,
      showInteractiveSetup: async (_ctx: any, telegramId: bigint) => {
        interactiveCalls.push([_ctx, telegramId]);
      },
      createGameViaCommand: async () => {
        commandCalls.push(true);
      },
      resolveTokenOverride: async () => null,
    };

    await handleCoinflipCommand(ctx, deps);

    expect(interactiveCalls.length).toBe(1);
    expect(interactiveCalls[0][0]).toBe(ctx);
    expect(interactiveCalls[0][1]).toBe(1n);
    expect(commandCalls.length).toBe(0);
    expect(ctx.__calls.length).toBe(0);
  });

  test("arguments delegate to command handler", async () => {
    const ctx: any = createTelegramContext("/cf 25");
    const interactiveCalls: any[] = [];
    const commandCalls: any[] = [];

    const deps: any = {
      isGroupChat: () => true,
      showInteractiveSetup: async (forwardedCtx: any, telegramId: bigint, override?: any) => {
        interactiveCalls.push({ forwardedCtx, telegramId, override });
      },
      createGameViaCommand: async (forwardedCtx: any, args: string[], telegramId: bigint) => {
        commandCalls.push({ forwardedCtx, args, telegramId });
      },
      resolveTokenOverride: async () => null,
    };

    await handleCoinflipCommand(ctx, deps);

    expect(interactiveCalls.length).toBe(0);
    expect(commandCalls.length).toBe(1);
    expect(commandCalls[0].forwardedCtx).toBe(ctx);
    expect(commandCalls[0].args).toEqual(["/cf", "25"]);
    expect(commandCalls[0].telegramId).toBe(1n);
  });

  test("token-only argument opens interactive setup with override", async () => {
    const ctx: any = createTelegramContext("/cf TIMBA");
    const interactiveCalls: any[] = [];
    const commandCalls: any[] = [];

    const deps: any = {
      isGroupChat: () => true,
      showInteractiveSetup: async (forwardedCtx: any, telegramId: bigint, override?: any) => {
        interactiveCalls.push({ forwardedCtx, telegramId, override });
      },
      createGameViaCommand: async () => {
        commandCalls.push(true);
      },
      resolveTokenOverride: async (tokenInput: string) => {
        if (tokenInput === "TIMBA") {
          return {
            tokenMint: "TIMBA_MINT",
            tokenTicker: "TIMBA",
            tokenDecimals: 6,
          };
        }
        return null;
      },
    };

    await handleCoinflipCommand(ctx, deps);

    expect(commandCalls.length).toBe(0);
    expect(interactiveCalls.length).toBe(1);
    expect(interactiveCalls[0].forwardedCtx).toBe(ctx);
    expect(interactiveCalls[0].telegramId).toBe(1n);
    expect(interactiveCalls[0].override).toEqual({
      tokenMint: "TIMBA_MINT",
      tokenTicker: "TIMBA",
      tokenDecimals: 6,
    });
  });

  const recordingDeps = (resolved: unknown = null) => {
    const calls = { interactive: 0, command: 0, resolved: [] as unknown[][] };
    const deps: any = {
      isGroupChat: () => true,
      showInteractiveSetup: async () => {
        calls.interactive += 1;
      },
      createGameViaCommand: async () => {
        calls.command += 1;
      },
      resolveTokenOverride: async (...args: unknown[]) => {
        calls.resolved.push(args);
        return resolved;
      },
    };
    return { deps, calls };
  };

  test("unknown token-only argument is rejected without opening setup", async () => {
    const ctx: any = createTelegramContext("/cf NOPE");
    const { deps, calls } = recordingDeps(null);

    await handleCoinflipCommand(ctx, deps);

    expect(calls.resolved).toEqual([["NOPE", 100]]);
    expect(calls.interactive).toBe(0);
    expect(calls.command).toBe(0);
    expect(ctx.__calls).toEqual([["reply", "Token unavailable. Check its symbol or address."]]);
  });

  test("does nothing but explain when the sender cannot be identified", async () => {
    const ctx: any = createTelegramContext("/cf 10", "group", { from: undefined });
    const { deps, calls } = recordingDeps();

    await handleCoinflipCommand(ctx, deps);

    expect(calls.interactive).toBe(0);
    expect(calls.command).toBe(0);
    expect(ctx.__calls).toHaveLength(1);
    expect(ctx.__calls[0][1]).toContain("Unable to resolve your Telegram identity");
  });

  test("treats a message without text as a bare command", async () => {
    const ctx: any = createTelegramContext("", "group", {
      message: { message_id: 1, date: 0, chat: { id: 100 } } as any,
    });
    const { deps, calls } = recordingDeps();

    await handleCoinflipCommand(ctx, deps);

    expect(calls.resolved).toEqual([]);
    expect(calls.interactive).toBe(1);
  });

  test("a menu-only coinflip replying to someone asks for the amount instead of opening a game", async () => {
    const ctx: any = createTelegramContext("/cf TKN");
    ctx.message.reply_to_message = {
      message_id: 9,
      from: { id: 5150, is_bot: false, first_name: "Ana" },
    };
    const opened: unknown[] = [];
    const deps: any = {
      isGroupChat: () => true,
      showInteractiveSetup: async () => {
        opened.push("menu");
      },
      createGameViaCommand: async () => {
        opened.push("game");
      },
      resolveTokenOverride: async () => {
        opened.push("token");
        return null;
      },
    };

    await handleCoinflipCommand(ctx, deps);

    expect(opened).toEqual([]);
    expect(ctx.__calls).toEqual([
      [
        "reply",
        "To challenge someone, reply to their message with <code>/cf &lt;amount&gt; [TOKEN]</code>.",
        { parse_mode: "HTML" },
      ],
    ]);
  });

  test.each(["/cf 10", "/cf"])(
    "%s replying to a message from another chat or topic is refused instead of opening a game",
    async (text) => {
      const ctx: any = createTelegramContext(text);
      ctx.message.external_reply = {
        origin: {
          type: "user",
          date: 0,
          sender_user: { id: 5150, is_bot: false, first_name: "Ana" },
        },
      };
      const opened: unknown[] = [];
      const deps: any = {
        isGroupChat: () => true,
        showInteractiveSetup: async () => {
          opened.push("menu");
        },
        createGameViaCommand: async () => {
          opened.push("game");
        },
        resolveTokenOverride: async () => null,
      };

      await handleCoinflipCommand(ctx, deps);

      expect(opened).toEqual([]);
      expect(ctx.__calls).toEqual([
        ["reply", "To challenge someone, reply to their message in this chat and topic."],
      ]);
    },
  );
});
