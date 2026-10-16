import { describe, expect, spyOn, test } from "bun:test";
import {
  CALLBACK_ANSWER_GRACE_MS,
  answerCallbackWithGrace,
  replyEphemeralToSender,
  replyToCallbackMessage,
  safeAnswerCallbackQuery,
} from "../src/utils/context-helpers";
import { telegramRefusal } from "./helpers/telegram-errors";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeCtx = () => {
  const answers: Array<string | undefined> = [];
  const replies: Array<[string, any]> = [];
  const ctx: any = {
    chat: { id: 5, type: "group" },
    callbackQuery: { id: "cb", message: { message_id: 77 } },
    answerCallbackQuery: async (text?: string) => {
      answers.push(text);
    },
    reply: async (text: string, options: any) => {
      replies.push([text, options]);
    },
  };
  return { ctx, answers, replies };
};

describe("answerCallbackWithGrace", () => {
  test("uses a short default grace period", () => {
    expect(CALLBACK_ANSWER_GRACE_MS).toBeLessThanOrEqual(500);
  });

  test("fast work answers the callback itself, once", async () => {
    const { ctx, answers } = makeCtx();
    const result = await answerCallbackWithGrace(
      ctx,
      async () => {
        await safeAnswerCallbackQuery(ctx, "✅ Joined! (2/4)");
        return 42;
      },
      { graceMs: 50, pendingText: "⏳ Joining…" },
    );
    await sleep(80);
    expect(result).toBe(42);
    expect(answers).toEqual(["✅ Joined! (2/4)"]);
  });

  test("fast work that never answers gets a silent answer", async () => {
    const { ctx, answers } = makeCtx();
    await answerCallbackWithGrace(ctx, async () => {}, { graceMs: 50 });
    expect(answers).toEqual([undefined]);
  });

  test("slow work shows the pending toast and routes late answers", async () => {
    const { ctx, answers } = makeCtx();
    const late: string[] = [];
    await answerCallbackWithGrace(
      ctx,
      async () => {
        await sleep(40);
        await safeAnswerCallbackQuery(ctx, "Failed to join game. Please try again.");
        await safeAnswerCallbackQuery(ctx);
      },
      {
        graceMs: 5,
        pendingText: "⏳ Joining…",
        onLateAnswer: (text) => {
          late.push(text);
        },
      },
    );
    expect(answers).toEqual(["⏳ Joining…"]);
    expect(late).toEqual(["Failed to join game. Please try again."]);
  });

  test("slow work without a pending text answers silently and drops late toasts", async () => {
    const { ctx, answers } = makeCtx();
    await answerCallbackWithGrace(
      ctx,
      async () => {
        await sleep(30);
        await safeAnswerCallbackQuery(ctx, "Refreshed!");
      },
      { graceMs: 5 },
    );
    expect(answers).toEqual([undefined]);
  });

  test("late answer fallback failures are contained", async () => {
    const { ctx, answers } = makeCtx();
    await answerCallbackWithGrace(
      ctx,
      async () => {
        await sleep(30);
        await safeAnswerCallbackQuery(ctx, "❌ boom");
      },
      {
        graceMs: 5,
        onLateAnswer: () => {
          throw new Error("reply failed");
        },
      },
    );
    expect(answers).toEqual([undefined]);
  });

  test("errors propagate and leave the answer to the caller", async () => {
    const { ctx, answers } = makeCtx();
    await expect(
      answerCallbackWithGrace(
        ctx,
        async () => {
          throw new Error("rpc down");
        },
        { graceMs: 50 },
      ),
    ).rejects.toThrow("rpc down");
    await safeAnswerCallbackQuery(ctx, "❌ Error");
    await sleep(80);
    expect(answers).toEqual(["❌ Error"]);
  });

  test("nested use keeps the outer grace window", async () => {
    const { ctx, answers } = makeCtx();
    await answerCallbackWithGrace(
      ctx,
      () =>
        answerCallbackWithGrace(
          ctx,
          async () => {
            await sleep(30);
          },
          { graceMs: 1, pendingText: "inner" },
        ),
      { graceMs: 5, pendingText: "outer" },
    );
    expect(answers).toEqual(["outer"]);
  });
});

describe("replyToCallbackMessage", () => {
  test("replies to the button message with an ephemeral message for the tapping user", async () => {
    const { ctx, replies } = makeCtx();
    ctx.from = { id: 9031 };
    await replyToCallbackMessage(ctx, "This game is no longer active!");
    expect(replies).toEqual([
      [
        "This game is no longer active!",
        {
          disable_notification: true,
          reply_to_message_id: 77,
          ephemeral_message_parameters: { receiver_user_id: 9031, callback_query_id: "cb" },
        },
      ],
    ]);
  });

  test("replies as usual in a private chat, where no one else can see it", async () => {
    const { ctx, replies } = makeCtx();
    ctx.chat = { id: 9031, type: "private" };
    ctx.from = undefined;
    await replyToCallbackMessage(ctx, "This game is no longer active!");
    expect(replies).toStrictEqual([
      ["This game is no longer active!", { disable_notification: true, reply_to_message_id: 77 }],
    ]);
  });

  test("stays ephemeral without a callback message", async () => {
    const { ctx, replies } = makeCtx();
    ctx.from = { id: 9031 };
    ctx.callbackQuery = undefined;
    await replyToCallbackMessage(ctx, "hi");
    expect(replies).toStrictEqual([
      [
        "hi",
        {
          disable_notification: true,
          ephemeral_message_parameters: { receiver_user_id: 9031 },
        },
      ],
    ]);
  });

  test("retries an expired tap once without its id", async () => {
    const { ctx } = makeCtx();
    ctx.from = { id: 9031 };
    const attempts: Array<[string, any]> = [];
    ctx.reply = async (text: string, options: any) => {
      attempts.push([text, options]);
      if (attempts.length === 1) {
        throw telegramRefusal(
          "Bad Request: query is too old and response timeout expired or query ID is invalid",
        );
      }
    };
    await replyToCallbackMessage(ctx, "Failed to join game. Please try again.");
    expect(attempts).toEqual([
      [
        "Failed to join game. Please try again.",
        {
          disable_notification: true,
          reply_to_message_id: 77,
          ephemeral_message_parameters: { receiver_user_id: 9031, callback_query_id: "cb" },
        },
      ],
      [
        "Failed to join game. Please try again.",
        {
          disable_notification: true,
          reply_to_message_id: 77,
          ephemeral_message_parameters: { receiver_user_id: 9031 },
        },
      ],
    ]);
  });

  test("falls back to a regular reply when no ephemeral message gets through", async () => {
    const { ctx } = makeCtx();
    ctx.from = { id: 9031 };
    const attempts: Array<[string, any]> = [];
    const refusals = [
      "Bad Request: query is too old and response timeout expired or query ID is invalid",
      "Bad Request: BOT_NOT_ADMIN",
    ];
    ctx.reply = async (text: string, options: any) => {
      attempts.push([text, options]);
      const refusal = refusals[attempts.length - 1];
      if (refusal) throw telegramRefusal(refusal);
    };
    await replyToCallbackMessage(ctx, "Failed to join game. Please try again.");
    expect(attempts).toEqual([
      [
        "Failed to join game. Please try again.",
        {
          disable_notification: true,
          reply_to_message_id: 77,
          ephemeral_message_parameters: { receiver_user_id: 9031, callback_query_id: "cb" },
        },
      ],
      [
        "Failed to join game. Please try again.",
        {
          disable_notification: true,
          reply_to_message_id: 77,
          ephemeral_message_parameters: { receiver_user_id: 9031 },
        },
      ],
      [
        "Failed to join game. Please try again.",
        { disable_notification: true, reply_to_message_id: 77 },
      ],
    ]);
  });

  test("passes on a refused regular reply", async () => {
    const { ctx } = makeCtx();
    ctx.from = { id: 9031 };
    let attempts = 0;
    ctx.reply = async () => {
      attempts += 1;
      throw telegramRefusal("Forbidden: bot was kicked from the supergroup chat", 403);
    };
    await expect(replyToCallbackMessage(ctx, "hi")).rejects.toThrow("bot was kicked");
    expect(attempts).toBe(3);
  });

  test("passes on a failed connection without trying again, since the reply may have arrived", async () => {
    const { ctx } = makeCtx();
    ctx.from = { id: 9031 };
    let attempts = 0;
    ctx.reply = async () => {
      attempts += 1;
      throw new Error("Network request for 'sendMessage' failed!");
    };
    await expect(replyToCallbackMessage(ctx, "hi")).rejects.toThrow("Network request");
    expect(attempts).toBe(1);
  });

  test("sends nothing without a tapping user or reply support", async () => {
    const { ctx, replies } = makeCtx();
    await replyToCallbackMessage(ctx, "Failed to join game. Please try again.");
    ctx.from = { id: 9031, is_bot: true };
    await replyToCallbackMessage(ctx, "Failed to join game. Please try again.");
    expect(replies).toEqual([]);
    await replyToCallbackMessage({ from: { id: 9031 } }, "ignored");
  });
});

const NOT_ADMIN = "Bad Request: BOT_NOT_ADMIN";

const makeCommandCtx = (chatType: string, refusals: string[] = []) => {
  const replies: Array<[string, any]> = [];
  const ctx: any = {
    chat: { id: -4120, type: chatType },
    from: { id: 7342 },
    reply: async (text: string, options: any) => {
      replies.push([text, options]);
      const refusal = refusals.shift();
      if (refusal) throw telegramRefusal(refusal);
    },
  };
  return { ctx, replies };
};

describe("replyEphemeralToSender", () => {
  test.each(["group", "supergroup"])(
    "replies in a %s with a message only the sender sees",
    async (type) => {
      const { ctx, replies } = makeCommandCtx(type);
      await replyEphemeralToSender(ctx, "You can't tip yourself!", { parse_mode: "HTML" });
      expect(replies).toEqual([
        [
          "You can't tip yourself!",
          { parse_mode: "HTML", ephemeral_message_parameters: { receiver_user_id: 7342 } },
        ],
      ]);
    },
  );

  test("replies publicly once when the bot is not a chat admin", async () => {
    const { ctx, replies } = makeCommandCtx("supergroup", [NOT_ADMIN]);
    await replyEphemeralToSender(ctx, "You can't tip yourself!", { parse_mode: "HTML" });
    expect(replies).toEqual([
      [
        "You can't tip yourself!",
        { parse_mode: "HTML", ephemeral_message_parameters: { receiver_user_id: 7342 } },
      ],
      ["You can't tip yourself!", { parse_mode: "HTML" }],
    ]);
  });

  test("replies publicly once and logs why when Telegram refuses the ephemeral message for another reason", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx, replies } = makeCommandCtx("group", ["Bad Request: TOPIC_CLOSED"]);
      await replyEphemeralToSender(ctx, "You can't tip yourself!");
      expect(replies).toEqual([
        ["You can't tip yourself!", { ephemeral_message_parameters: { receiver_user_id: 7342 } }],
        ["You can't tip yourself!", {}],
      ]);
      expect(warn.mock.calls).toEqual([
        ["Telegram refused an ephemeral message:", "Bad Request: TOPIC_CLOSED"],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("passes on a failed connection without a public reply, since the message may have arrived", async () => {
    const { ctx, replies } = makeCommandCtx("group");
    ctx.reply = async (text: string, options: any) => {
      replies.push([text, options]);
      throw new Error("Network request for 'sendMessage' failed!");
    };
    await expect(replyEphemeralToSender(ctx, "You can't tip yourself!")).rejects.toThrow(
      "Network request",
    );
    expect(replies).toEqual([
      ["You can't tip yourself!", { ephemeral_message_parameters: { receiver_user_id: 7342 } }],
    ]);
  });

  test("passes on a refused public reply", async () => {
    const { ctx, replies } = makeCommandCtx("group", [NOT_ADMIN, NOT_ADMIN]);
    await expect(replyEphemeralToSender(ctx, "You can't tip yourself!")).rejects.toThrow(
      "BOT_NOT_ADMIN",
    );
    expect(replies).toHaveLength(2);
  });

  test("replies as usual in private chats", async () => {
    const { ctx, replies } = makeCommandCtx("private");
    await replyEphemeralToSender(ctx, "Open a private chat with the bot to deposit.", {
      parse_mode: "HTML",
    });
    expect(replies).toEqual([
      ["Open a private chat with the bot to deposit.", { parse_mode: "HTML" }],
    ]);
  });

  test("replies as usual in groups when the sender is unknown", async () => {
    const { ctx, replies } = makeCommandCtx("group");
    ctx.from = undefined;
    await replyEphemeralToSender(ctx, "You can't tip yourself!");
    expect(replies).toEqual([["You can't tip yourself!", {}]]);
  });

  test.each([
    ["an anonymous admin", { id: 1087968824, is_bot: true, first_name: "Group" }],
    ["a channel", { id: 136817688, is_bot: true, first_name: "Channel" }],
  ])(
    "replies as usual to %s, since Telegram refuses ephemeral messages to bots",
    async (_name, from) => {
      const { ctx, replies } = makeCommandCtx("supergroup");
      ctx.from = from;
      await replyEphemeralToSender(ctx, "You can't tip yourself!");
      expect(replies).toEqual([["You can't tip yourself!", {}]]);
    },
  );
});
