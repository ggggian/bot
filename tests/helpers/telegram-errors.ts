/** The error grammY throws when Telegram refuses a sendMessage call. */
export const telegramRefusal = (description: string, errorCode = 400): Error =>
  Object.assign(new Error(`Call to 'sendMessage' failed! (${errorCode}: ${description})`), {
    error_code: errorCode,
    description,
  });
