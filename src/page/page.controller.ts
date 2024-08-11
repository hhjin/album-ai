import { Get, Controller, Render, Query, Logger, Param } from '@nestjs/common';
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
  async root(@Query('query') query?: string, @Query('searchQuery') searchQuery?: string, @Query('fId') fId?: string) {
    this.logger.log('query: ' + query);
    this.logger.log('searchQuery: ' + searchQuery);
    this.logger.log('fId: ' + fId);

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

    if (fId) {
      const currentFile = await this.fileService.findFile(fId);
      if (!currentFile) 
        return ;
      const surroundingImages = await this.fileService.getSurroundingImages(currentFile, 20);
      const path_of_parentImage = currentFile.path.replace(/\\/g, '/').replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1');
      return {
        surroundingImages,
        path_of_parentImage,
      };
    }

    return {
      query: query || null,
    };
  }
}