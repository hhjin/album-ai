import { Injectable } from '@nestjs/common';
import { openai } from '../app.module';

@Injectable()
export class EmbeddingService {
  // 现在 Unused ,没有被用到。 embedding 都是 pg-vector-store.service 中的方法
  public async embeddingByOpenAI(text: string) {
    if (process.env.EMBEDDING_PROVIDER == 'openai') {
      console.log("###### openai.embeddings "+text)
      const response = await openai.embeddings.create({
        model: process.env.EMBEDDING_PROVIDER_MODEL,
        input: text,
      });
      return response.data[0].embedding;
    } else {
      throw new Error(`no support. provider=${process.env.EMBEDDING_PROVIDER}`);
    }
  }
}
