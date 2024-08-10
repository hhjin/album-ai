import { Injectable } from '@nestjs/common';
import { FileService } from './file.service';
import { anthropicClient, openai,openai_azure_chat } from '../app.module';
import Anthropic from '@anthropic-ai/sdk';
import TextBlock = Anthropic.TextBlock;
import { replacePlaceholders } from '../common';

@Injectable()
export class ChatService {
  constructor(private readonly fileService: FileService) {}

  public async chat(input: { text: string }) {
    const res = await this.fileService.searchDetail(input.text);
    if (!res) {
      return { code: 404, msg: 'Not found' };
    }
    const { results, urls, fileAlbums } = res;
    if (!results || results.length == 0) {

      return {
        content: 'No relevant images were found in your album. Please add images or modify the search query.',
      };
    }

    // 修改 results 中的 pageContent，替换路径分隔符
    results.forEach(result => {
      result.forEach((item: any) => {
        if (item.pageContent) {
          item.pageContent = item.pageContent.replace(/\\/g, '/');
        }
      });
    });

    // 提取路径并替换分隔符，同时添加 fId 字段
    const paths = fileAlbums.map(album => ({
      path: album.path.replace(/\\/g, '/'),
      fId: album.fId.toString(), // 将 fId 转换为字符串
    }));

    // 合并 urls 和 paths 到一个变量 urls_paths
    const urls_paths = urls.map(url => {
      const pathObj = paths.find(path => path.fId === url.fId);
      return {
        ...url,
        path: pathObj ? pathObj.path : null,
      };
    });
    console.log(
      replacePlaceholders(
        process.env.CHAT_PROVIDER_PROMPT,
        input.text,
        JSON.stringify({ results, urls_paths }),
      ),
    );
    
    let content: string;
    if (process.env.CHAT_PROVIDER == 'openai') {
      const response = await openai.chat.completions.create({
        model: process.env.CHAT_PROVIDER_MODEL,
        max_tokens: 1024,
        temperature: 0.5,
        messages: [
          {
            role: 'user',
            content: replacePlaceholders(
              process.env.CHAT_PROVIDER_PROMPT,
              input.text,
              JSON.stringify({ results, urls }),
            ),
          },
        ],
      });
      content = response.choices[0].message.content;
      console.log("\n\n#### ########### ########### ChatService ###########  "+process.env.CHAT_PROVIDER_MODEL)
    } 
    else if (process.env.CHAT_PROVIDER == 'azure') {
      const response = await openai_azure_chat.chat.completions.create({
        model: process.env.CHAT_PROVIDER_MODEL,
        max_tokens: 1024,
        temperature: 0.5,
        messages: [
          {
            role: 'user',
            content: replacePlaceholders(
              process.env.CHAT_PROVIDER_PROMPT,
              input.text,
              JSON.stringify({ results, urls }),
            ),
          },
        ],
      });
      content = response.choices[0].message.content;
      console.log("\n\n#### ########### ########### ChatService ###########  "+process.env.CHAT_PROVIDER_MODEL)
    } 
    else if (process.env.CHAT_PROVIDER == 'anthropic') {
      const response = await anthropicClient.messages.create({
        model: process.env.CHAT_PROVIDER_MODEL,
        max_tokens: 1024,
        temperature: 0.5,
        messages: [
          {
            role: 'user',
            content: replacePlaceholders(
              process.env.CHAT_PROVIDER_PROMPT,
              input.text,
              JSON.stringify({ results, urls }),
            ),
          },
        ],
      });
      content = (response.content[0] as TextBlock).text;
    } else {
      throw new Error(`no support. provider=${process.env.CHAT_PROVIDER}`);
    }
    return {
      content,
    };
  }
}
