import { Get, Controller, Render, Query, Logger } from '@nestjs/common';
import { ChatService } from '../file/chat.service';
import { FileService } from '../file/file.service';

@Controller('/')
export class PageController {
  private readonly logger = new Logger(PageController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly fileService: FileService
  ) {}

  @Get('/')
  @Render('index')
  async root(@Query('query') query?: string, @Query('searchQuery') searchQuery?: string) {
    this.logger.log('query: ' + query);
    this.logger.log('searchQuery: ' + searchQuery);

  if (query) {
      const { content } = await this.chatService.chat({ text: query });
      this.logger.log('Answer:', content);
      return {
        answer: content,
        query: query || null,
      };
    }

    if (searchQuery) {
      const searchResults = await this.fileService.searchImages(searchQuery);
      return {
        searchResults,
        searchQuery,
      };
    }

    return {
      query: query || null,
    };
  }
}