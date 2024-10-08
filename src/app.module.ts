import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { configService } from './config/config.service.js';
import { FileModule } from './file/file.module.js';
import { TaskService } from './task/task.service.js';
import {OpenAI ,AzureOpenAI} from 'openai';
import * as process from 'node:process';
import { EmbeddingService } from './remote/embedding.service';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ExtractImageService } from './remote/extract-image.service';
import { PgVectorStoreService } from './remote/pg-vector-store.service';
import { PageController } from './page/page.controller';
import { ChatService } from './file/chat.service';
import Anthropic from '@anthropic-ai/sdk';

@Module({
  controllers: [PageController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(configService.getTypeOrmConfig()),
    ScheduleModule.forRoot(),
    FileModule,
  ],
  providers: [
    TaskService,
    EmbeddingService,
    ExtractImageService,
    PgVectorStoreService,
    ChatService,
  ],
})
export class AppModule {}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  httpAgent: process.env.PROXY_URL
    ? new HttpsProxyAgent(process.env.PROXY_URL)
    : undefined,
});

export const openai_azure_chat = new AzureOpenAI({
  apiKey:       process.env.AZURE_OPENAI_API_KEY,
  apiVersion  : process.env.AZURE_OPENAI_API_VERSION,
  endpoint :    process.env.AZURE_OPENAI_ENDPOINT,
  deployment :  process.env.CHAT_PROVIDER_MODEL,
  httpAgent: process.env.PROXY_URL
    ? new HttpsProxyAgent(process.env.PROXY_URL)
    : undefined,
});

export const openai_azure_image_extract = new AzureOpenAI({
  apiKey:       process.env.AZURE_OPENAI_API_KEY,
  apiVersion  : process.env.AZURE_OPENAI_API_VERSION,
  endpoint :    process.env.AZURE_OPENAI_ENDPOINT,
  deployment :  process.env.IMAGE_EXTRACT_PROVIDER_MODEL,
  httpAgent: process.env.PROXY_URL
    ? new HttpsProxyAgent(process.env.PROXY_URL)
    : undefined,
});


export const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  httpAgent: process.env.PROXY_URL
    ? new HttpsProxyAgent(process.env.PROXY_URL)
    : undefined,
});
