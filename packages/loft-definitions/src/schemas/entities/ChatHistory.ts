import { z } from 'zod';

import { Message } from './Message';

export const ChatHistory = z.array(Message);
