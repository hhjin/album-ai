import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FileAlbum } from './file-scan.entity.js';
import { In, MoreThan,LessThan, Repository, Not, IsNull } from 'typeorm';
import { glob } from 'glob';
import { configService } from '../config/config.service.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import crc32 from 'crc/crc32';
import * as mime from 'mime-types';
import { FileStatus } from '../common';
import { ExtractImageService } from '../remote/extract-image.service';
import { PgVectorStoreService } from '../remote/pg-vector-store.service';
const ExifImage = require('exif').ExifImage;


@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  private hasScanFileTask = false;
  private hasExtractDescTask = false;
  private hasEmbeddingTask = false;
  private hasHeartBeatingTask = false;

  private InitialScanFileExecuted = false;
  private InitialExtractDescExecuted = false;
  private InitialEmbeddingExecuted = false;
  private hasUpdateStatusFromIgnore2InitTask = false;
  private hasUpdateExifDataForEmbeddedFilesTask = false;


  public async heartBeating (initFileScan:boolean=true) {
    if (this.hasHeartBeatingTask )
      return
    this.hasHeartBeatingTask=true

    try {
      //this.updateExifDataForEmbeddedFiles();
      //this.updateStatusFromIgnore2Init();  

      if ( ! this.hasScanFileTask && ! this.InitialScanFileExecuted && initFileScan){
        this.logger.log('InitialScanFileExecuting')
        await this.scanFile()
        this.InitialScanFileExecuted = true;
      }
     
      if ( ! this.hasExtractDescTask && ! this.InitialExtractDescExecuted){
        this.logger.log('InitialExtractDescExecuting')
        await this.extractDesc()
        this.InitialExtractDescExecuted = true;
      }
      
      if ( ! this.hasEmbeddingTask && ! this.InitialEmbeddingExecuted){
        this.logger.log('InitialEmbeddingExecuting')
        await this.embedding();
        this.InitialEmbeddingExecuted = true;
      }

    } catch (err) {
      this.logger.error('HeartBeating with error :'+err);
      if (err.cause) this.logger.error( err.cause);
    } finally {
      this.hasHeartBeatingTask = false;
    }

  }


  constructor(
    @InjectRepository(FileAlbum)
    private readonly fileRepository: Repository<FileAlbum>,
    private readonly extractImageService: ExtractImageService,
    private readonly pgVectorStoreService: PgVectorStoreService,
  ) {}

  public findAll() {
    return this.fileRepository.find();
  }

// select file_name, path,status from file_album ;
  public async getFilePathList_inDB() {
    return this.fileRepository.find({
      select: ['fId', 'fileName', 'path', 'status'],
    });
  }

  public async findNewFiles(filePaths: string[], filePaths_inDB: FileAlbum[]) {
    // 创建一个 Set 来存储数据库中的文件路径，以便快速查找
    const dbPathSet = new Set();
  
    // 处理路径替换,//某些情况下，相册根目录会变动（如App从Mac迁移到Windows), postgres数据表里path存放是生成数据时的路径ALBUM_PATH_OLD。 需要 重替换为当前ALBUM_PATH路径。
    const albumPathOld = process.env.ALBUM_PATH_OLD;
    const albumPathNew = process.env.ALBUM_PATH;
    const regex = albumPathOld ? new RegExp(`^${albumPathOld}`) : null;
  
    filePaths_inDB.forEach(file => {
      let path = file.path;
      if (albumPathOld && regex && !path.startsWith(albumPathNew)) {
        path = path.replace(regex, albumPathNew);
        //this.logger.log(`文件 ID ${file.fId} 的路径 ${file.path} 不匹配 env.ALBUM_PATH，已替换为 ${path}`);
      }
      dbPathSet.add(path);
    });
  
    // 过滤出不在数据库中的文件路径
    const newFilePaths = filePaths.filter(path => !dbPathSet.has(path)); 
    const filteredNewFilePaths = newFilePaths.filter(path => !path.endsWith('.NEF'));
  
  
    return  filteredNewFilePaths;
  }

  // 将 cleanExifData 作为类的方法
  private cleanExifData(data: any): any {
    if (typeof data === 'string') {
      // 移除所有 null 字符和其他不可打印字符
      return data.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    } else if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data)) {
        return data.map(item => this.cleanExifData(item));
      } else {
        const cleanedObj = {};
        for (const key in data) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            cleanedObj[key] = this.cleanExifData(data[key]);
          }
        }
        return cleanedObj;
      }
    }
    return data;
  }
  public async getExifData(imagePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        new ExifImage({ image: imagePath }, (error, exifData) => {
          if (error) {
            //this.logger.error(`获取 EXIF 数据出错: ${error.message}`);
            resolve(null);  // 出错时返回 null
          } else {
            //this.logger.debug(`获取图像 EXIF 信息 ${imagePath}:\n${JSON.stringify(exifData, null, 2)}`);
            resolve(exifData);
          }
        });
      } catch (error) {
        this.logger.error(`创建 ExifImage 实例出错: ${error.message}`);
        resolve(null);  // 出错时返回 null
      }
    });
  }

  public  getPhotoTime(exifData: any): Date | null {
    let photoTime: Date | null = null;
    if (exifData?.exif?.DateTimeOriginal) {
      const dateTimeOriginal = exifData.exif.DateTimeOriginal;
      
      // 检查日期格式是否符合预期
      const dateRegex = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
      const match = dateTimeOriginal.match(dateRegex);
      
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        photoTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
        
        // 检查生成的日期是否有效
        if (isNaN(photoTime.getTime())) {
          photoTime = null;
          this.logger.warn(`Invalid date generated from EXIF: ${dateTimeOriginal}`);
        }
      } else {
        this.logger.warn(`Unexpected EXIF date format: ${dateTimeOriginal}`);
      }
    }
    
    return photoTime;
  }
  
  public async scanFile() {
    if (this.hasScanFileTask) {
      return;
    }
  
    this.hasScanFileTask = true;
    try {
      const dir = configService.getAlbumDir();
      const filePaths = await glob(`${dir}/**/*`);
  
      const filePaths_inDB = await this.getFilePathList_inDB();
  
      // 找出新文件路径 (对于 图像源素材 ，filePaths 12万6千个文件，filePaths_inDB 10万8千8百个文件， NEF 文件9千多，重复文件9千多个)
      const newFilePaths = await this.findNewFiles(filePaths, filePaths_inDB);
  
      // 处理新文件，限制为2000条记录
      const MAX_FILES = 2000;
      let newFilesCount = 0;
      const fileDetails = [];

      for (const filePath of newFilePaths.reverse()) { //倒序以和文件名排序一致
        if (newFilesCount >= MAX_FILES) break;
        let stats, fileBuffer, crc, contentType;
        try {
          stats = fs.lstatSync(filePath);
          if (stats.isDirectory()) continue; // 跳过目录

          fileBuffer = fs.readFileSync(filePath);
          crc = crc32(fileBuffer).toString(16);
    
          if (crc && crc.length >= 64) {
            this.logger.warn(`CRC长度超过64个字符: ${crc}  ${filePath}`);
            continue;
          }
          contentType = mime.lookup(filePath) || 'unknown';
          if (contentType && contentType.length >= 64) {
            this.logger.warn(`内容类型长度超过64个字符: ${contentType}  ${filePath}`);
            continue;
          }
          // 检查CRC是否已存在于数据库中
          const existingFile = await this.fileRepository.findOne({ where: { crc } });
          if (existingFile) {
            //this.logger.warn(`文件已存在，跳过: ${filePath}`);
            continue;
          }

          fileDetails.push({
            path: filePath,
            name: path.basename(filePath),
            isDirectory: false,
            size: stats.size,
            crc: crc,
            fileType: contentType,
          });

          newFilesCount++;
        } catch (err) {
          this.logger.warn('读取文件出错 ' + filePath, err);
          continue;
        }
      }

      //用于类似图像源素材文件数巨量，大量连拍的情况。 最初每 igonoredInterval=5 个设置为Init，其它为Ignore. 第二次，通过 updateStatusFromIgnore2Init，再选择间隔设置为Init.
      const igonoredInterval = 1; 

      this.logger.warn(`\n#### Insert **NEW** files to DB, count : ${fileDetails.length} `);
      // 批量插入新文件到数据库
      const dataList = fileDetails.map((item, index) => {
        return {
          fileName: item.name,
          path: item.path,
          crc: item.crc,
          status: index % igonoredInterval === 0 ? FileStatus.Init : FileStatus.Ignore,
          crcFile: item.fileType,
          contentType: item.fileType,
          size: item.size,
        } as Partial<FileAlbum>;
      });
      // save DB
      await this.fileRepository
        .createQueryBuilder()
        .insert()
        .into(FileAlbum)
        .values(dataList)
        .orIgnore()
        .execute();

      const new_file_count = await this.fileRepository.count({
        where: {
          status: FileStatus.Init,
        },
      });
      this.logger.warn(`FileStatus.Init in DB:  ${new_file_count} `);

    } catch (error) {
      this.logger.error('\n###### exec scanning file error', error);
    } finally {
      this.hasScanFileTask = false;
    }
  }


  //用于类似图像源素材文件数巨量，大量连拍的情况。 最初每 igonoredInterval=5 个设置为Init，其它为Ignore. 第二次，通过 updateStatusFromIgnore2Init，再选择间隔设置为Init. 
  private async updateStatusFromIgnore2Init() {
    if (this.hasUpdateStatusFromIgnore2InitTask) {
      return;
    }
    this.hasUpdateStatusFromIgnore2InitTask = true;

    let updateStatusFromIgnore2Init_count = 0;
    let total_count = 0;
    while (updateStatusFromIgnore2Init_count <= 0) {
    const dataList = await this.fileRepository.find({
      where: {
        fId: MoreThan(0n),
        status: FileStatus.Embedding,
      },
          take: 20000,
      order: { fId: 'asc' },
    });
    

    if (!dataList || dataList.length == 0) {
      return;
    }

      for (const fileAlbum of dataList) { // 20000
      const fId= fileAlbum.fId;
      const fId_tobe_updated = BigInt(fId) + 2n; 
      const fileAlbumTobeUpdated = await this.fileRepository.findOne({ where: { fId: fId_tobe_updated ,status: FileStatus.Ignore, } });
      if (fileAlbumTobeUpdated) {
          total_count++;
          this.logger.warn(`updateStatusFromIgnore2Init fId: ${fId_tobe_updated}   total_count: ${total_count} path: ${fileAlbumTobeUpdated.path} `);
          await this.fileRepository.update(
            {
              fId: fId_tobe_updated 
            },
            {
              status: FileStatus.Init,
            }
          );
        }
      }//for
      updateStatusFromIgnore2Init_count++;
      this.logger.warn(`updateStatusFromIgnore2Init_count of batch 2000 : ${updateStatusFromIgnore2Init_count}  total_count: ${total_count} `);
    }//while
  }

  public async extractDesc() {
    if (this.hasExtractDescTask) {
      return;
    }
    this.hasExtractDescTask = true;
    try {
      let cursorId = 0n;

        const dataList = await this.fileRepository.find({
          where: {
            fId: MoreThan(cursorId),
            status: FileStatus.Init,
          },
          take: 100,
          order: { fId: 'asc' },
        });

        if (!dataList || dataList.length == 0) {
          return;
        }
        cursorId = dataList[dataList.length - 1].fId;

        for (const fileAlbum of dataList) {
          const tobe_extractImgDesc_count = await this.fileRepository.count({
            where: {
              status: FileStatus.Init,
            },
          });
          this.logger.warn(`\n### tobe_extractImgDesc_count ${tobe_extractImgDesc_count} ,  extract fileAlbum id: ${fileAlbum.fId}  name: ${fileAlbum.fileName}`);
          let content , exifData , photoTime
          let is_extract_aidesc = false;
          try {
            const imageBuf = await this.extractImageService.compressImageToBuffer(
              fileAlbum.path,
              80,
            );
            const base64 = await this.extractImageService.imageToBase64(imageBuf);
            exifData = await this.getExifData(fileAlbum.path);
            exifData = this.cleanExifData(exifData);
            photoTime = this.getPhotoTime(exifData);
            is_extract_aidesc = true;
            content = await this.extractImageService.extractImageInfo(
                base64,
                'image/jpeg',
              );
              this.logger.log('extract Image AI Desc, model : ' +  process.env.IMAGE_EXTRACT_PROVIDER_MODEL+"  fileName: "+  fileAlbum.fileName+'\n '+content);  
          } catch (err) {
             
            this.logger.error("extract Image AI Desc: "  + fileAlbum.fileName+ ' with error :'+ err )
            if (err.cause) this.logger.error(err.cause)
            const errString = err.toString();
            if ( ! is_extract_aidesc ) {
              this.logger.warn(`不支持的图像格式: ${fileAlbum.fileName}`);
              await this.fileRepository.update(
                {
                  fId: fileAlbum.fId,
                  status: FileStatus.Init,
                },
                {
                  status: FileStatus.UnsupportedFormat,
                }
              );
            }else    if (errString.includes("triggering Azure OpenAI's content management policy")) {
              this.logger.warn(`Content Policy rejected : ${fileAlbum.fileName}`);
              await this.fileRepository.update(
                {
                  fId: fileAlbum.fId,
                  status: FileStatus.Init,
                },
                {
                  status: FileStatus.ContentPolicy,
                }
              );
            } 
            continue;
          }

          // 准备更新对象
          const updateData: Partial<FileAlbum> = {
            descAi: content,
            status: FileStatus.Extract,
          };

          // 只有在 photoTime 存在时才添加到更新对象中
          if (photoTime) {
            updateData.photo_time = photoTime;
          }

          // 只有在 exifData 存在时才添加到更新对象中
          if (exifData) {
            updateData.exif = exifData;
          }
          this.logger.warn(`start updateDB fileAlbum id: ${fileAlbum.fId}  name: ${fileAlbum.fileName} `);
          await this.fileRepository.update(
            {
              fId: fileAlbum.fId,
              status: FileStatus.Init,
            },
            updateData
          );
          this.logger.warn(`Done! updateDB fileAlbum id: ${fileAlbum.fId}  name: ${fileAlbum.fileName}  status: ${updateData.status}\n`);

        } // for dataList
      
    } catch (err) {
      this.logger.error('exec extracting Desc error :'+err);
      if (err.cause) this.logger.error( err.cause);
    } finally {
      this.hasExtractDescTask = false;
    }
  }

  public async embedding() {
    if (this.hasEmbeddingTask) {
      return;
    }
    this.hasEmbeddingTask = true;
    try {
      let cursorId = 0n;
      while (true) {
        const tobe_embedding_count = await this.fileRepository.count({
          where: {
            status: FileStatus.Extract,
          },
        });
        this.logger.warn('tobe_embedding_count(path+desc) : '+tobe_embedding_count);

        const dataList = await this.fileRepository.find({
          where: {
            fId: MoreThan(cursorId),
            status: FileStatus.Extract,
          },
          take: 100,
          order: { fId: 'asc' },
        });

        if (!dataList || dataList.length == 0) {
          return;
        }

        cursorId = dataList[dataList.length - 1].fId;
        const docs = dataList
        .filter(item => item.descAi != '') // 过滤掉 descAi 为空 的项
        .map((item) => {
          return {
            pageContent: item.path + '\n## Image Description: \n' + item.descAi,
            metadata: { fId: item.fId.toString() },
          } as { pageContent: string; metadata: Record<string, any> };
        });

        this.logger.warn(`pgVectorStoreService embedding batch : ${dataList.length}`);

        await this.pgVectorStoreService.addDocs(docs);

        await this.fileRepository.update(
          {
            fId: In(dataList.map((item) => item.fId)),
            status: FileStatus.Extract,
          },
          {
            status: FileStatus.Embedding,
          },
        );

        const already_embedded_count = await this.fileRepository.count({
          where: {
            status: FileStatus.Embedding,
          },
        });
        this.logger.warn('already_embedded_count : '+already_embedded_count);

      }
    } catch (err) {
      console.log(err);
      this.logger.warn('exec embedding error', err);
    } finally {
      this.hasEmbeddingTask = false;
    }
  }

  public async searchDetail(query: string, score?: number, limit?: number) {
    try {
      let results = await this.pgVectorStoreService.search(
        query,
        limit ?? parseInt(process.env.MAX_SEARCH_LIMIT),
      );
      if (!results || results.length == 0) {
        return;
      }
      score = score ?? parseFloat(process.env.SIMILARITY_SCORE);
      results = results.filter((item) => item[1] < score);
      const fIds = results.map((item) => item[0].metadata.fId);
      const fileAlbums = await this.fileRepository.find({
        where: {
          fId: In(fIds),
        },
      });
      const fileUrls = fIds.map((fId) => {
        return {
          fId,
          url: `${configService.getHostName()}/api/v1/file/${fId}/download`,
        };
      });
      return {
        results,
        fileAlbums,
        urls: fileUrls,
      };
    } catch (err) {
      this.logger.error('searchDetail error '+ err);
      this.logger.error(err.cause)
      throw err
    }
  }

  public async updateExifDataForEmbeddedFiles() {
    if (this.hasUpdateExifDataForEmbeddedFilesTask) {
      return;
    }
    this.hasUpdateExifDataForEmbeddedFilesTask = true;
    this.logger.log('开始更新已嵌入文件的 EXIF 数据');
    let processedCount = 0;
    let updatedCount = 0;
    let cursorId = 0n;

    while (true) {
      const files = await this.fileRepository.find({
        where: {
          fId: MoreThan(cursorId),
          status: FileStatus.Embedding,
        },
        take: 100,
        order: { fId: 'ASC' },
      });

      if (files.length === 0) {
        break;
      }

      cursorId = files[files.length - 1].fId;

      for (const file of files) {
        processedCount++;
        try {
          if (!file.path.startsWith(process.env.ALBUM_PATH)) {
            const regex = new RegExp(`^${process.env.ALBUM_PATH_OLD}`);
            file.path = file.path.replace(regex, process.env.ALBUM_PATH);
            file.path = file.path.replaceAll('\\', '/');
            
          }
          const exifData = await this.getExifData(file.path);
          const cleanedExifData = this.cleanExifData(exifData);
          const photoTime = this.getPhotoTime(cleanedExifData);

          const updateData: Partial<FileAlbum> = {
            exif: cleanedExifData,
          };

          if (photoTime) {
            updateData.photo_time = photoTime;
          }
          if (photoTime || cleanedExifData) {
            await this.fileRepository.update(
              { fId: file.fId },
              updateData
            );

            updatedCount++;
            if (processedCount % 100 === 0) {
              this.logger.log(`已处理 ${processedCount} 个文件，更新了 ${updatedCount} 个文件的 EXIF 数据`);
            }
          }
        } catch (error) {
          //this.logger.error(`更新文件 ${file.fileName} 的 EXIF 数据时出错：${error.message}`);
        }
      }
    }

    this.logger.log(`EXIF 数据更新完成。总共处理了 ${processedCount} 个文件，更新了 ${updatedCount} 个文件的 EXIF 数据`);
  }

  public async searchImages(query: string) {
    const scoreThreshold = 0.23; // 设置相似度阈值
    const results = await this.pgVectorStoreService.search(query, 21); // 限制结果为21张图片
    if (!results || results.length === 0) {
      return [];
    }

    const filteredResults = results.filter((item) => {
      const fId = item[0].metadata.fId;
      const score = item[1];
      return score <= scoreThreshold; // 过滤掉大于 scoreThreshold 的结果
    });

    const fIds = filteredResults.map((item) => item[0].metadata.fId);
    const fileAlbums = await this.fileRepository.find({
      where: {
        fId: In(fIds),
      },
    });
    this.logger.log(`\n\n## searchImages result size: ${filteredResults.length}`);
    const imagesData = filteredResults.map((item) => {
      const file = fileAlbums.find(f => f.fId.toString() === item[0].metadata.fId);
      const path = file.path.replace(/\\/g, '/');
      const trimmedPath = path.replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1');
      const formattedPhotoTime = file.photo_time ? this.formatPhotoTime(file.photo_time) : ' ';
      return {
        fId: file.fId,
        fileName: file.fileName,
        path: trimmedPath,
        url: `${configService.getHostName()}/api/v1/file/${file.fId}/download`,
        score: item[1].toFixed(3),
        photo_time: formattedPhotoTime,
        exif: file.exif || ' ',
      };
    });

    imagesData.forEach((item) => {
      console.log(`### score: ${item.score},  ### fId: ${item.fId},  ### path: ${item.path},    ### url: ${item.url}, `);
    });
    
    return imagesData;
  }

  public async getSurroundingImages(currentFile: FileAlbum, count: number) {
    this.logger.log(`\n\n## getSurroundingImages  fId: ${currentFile.fId},  path: ${currentFile.path},  count: ${count}`);
    
    const halfCount = Math.floor(count / 2);
    const surroundingFiles1 = await this.fileRepository.find({
      where: [
        { fId: MoreThan(currentFile.fId) },
      ],
      order: { fId: 'ASC' },
      take: halfCount,
    });

    const surroundingFiles2 = await this.fileRepository.find({
      where: [
        { fId: LessThan(currentFile.fId) },
      ],
      order: { fId: 'DESC' },
      take: halfCount,
    });
  
    const imagesData = surroundingFiles2.reverse().map((file) => {
      const path = file.path.replace(/\\/g, '/');
      const trimmedPath = path.replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1');
      const formattedPhotoTime = file.photo_time ? this.formatPhotoTime(file.photo_time) : ' ';
      return {
        fId: file.fId,
        fileName: file.fileName,
        path: trimmedPath,
        url: `${configService.getHostName()}/api/v1/file/${file.fId}/download`,
        photo_time: formattedPhotoTime,
        exif: file.exif || ' ',
      };
    });

    // 添加 currentFile 到 imagesData
    const currentFormattedPhotoTime = currentFile.photo_time ? this.formatPhotoTime(currentFile.photo_time) : ' ';
    imagesData.push({
      fId: currentFile.fId,
      fileName: currentFile.fileName,
      path: currentFile.path.replace(/\\/g, '/').replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1'),
      url: `${configService.getHostName()}/api/v1/file/${currentFile.fId}/download`,
      photo_time: currentFormattedPhotoTime,
      exif: currentFile.exif || ' ',
    });

    imagesData.push(...surroundingFiles1.map((file) => {
      const path = file.path.replace(/\\/g, '/');
      const trimmedPath = path.replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1');
      const formattedPhotoTime = file.photo_time ? this.formatPhotoTime(file.photo_time) : ' ';
      return {
        fId: file.fId,
        fileName: file.fileName,
        path: trimmedPath,
        url: `${configService.getHostName()}/api/v1/file/${file.fId}/download`,
        photo_time: formattedPhotoTime,
        exif: file.exif || ' ',
      };
    }));
    
    imagesData.forEach((item) => {
      console.log(`### ### fId: ${item.fId},  ### path: ${item.path},  ### photo_time: ${item.photo_time}`);
    }); 
    return imagesData;
  }

  private formatPhotoTime(photoTime: Date): string {
    return photoTime.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false, // 24小时制
  }).replace(',', ''); // 去掉日期和时间之间的逗号
  }


  public async findFile(fId: string) {
    return await this.fileRepository.findOne({
      where: {
        fId: BigInt(fId),
      },
    });
  }

  async getNearbyImages(fId: bigint, limit: number = 9): Promise<any[]> {
    const currentImage = await this.fileRepository.findOne({ where: { fId } });
    if (!currentImage || !currentImage.exif || !currentImage.exif['gps']) {
      this.logger.log('\n### 没有 Exif 信息。');
      return [];
    }

    const { GPSLatitude, GPSLongitude } = currentImage.exif['gps'];
    if (!GPSLatitude || !GPSLongitude) {
      this.logger.log('\n### 没有 GPS 信息。');
      return [];
    }

    const nearbyImages = await this.fileRepository
      .createQueryBuilder('file')
      .where(`
        file.exif->'gps'->'GPSLatitude' IS NOT NULL AND
        file.exif->'gps'->'GPSLongitude' IS NOT NULL AND
        jsonb_array_length(file.exif->'gps'->'GPSLatitude') = 3 AND
        jsonb_array_length(file.exif->'gps'->'GPSLongitude') = 3 AND
        (file.exif->'gps'->'GPSLatitude'->0)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->1)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->2)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->0)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->1)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->2)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->0)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLatitude'->1)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLatitude'->2)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->0)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->1)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->2)::text::float IS NOT NULL
      `)
      .orderBy(`
        ST_Distance(
          ST_SetSRID(ST_MakePoint(
            (file.exif->'gps'->'GPSLongitude'->0)::text::float + 
            (file.exif->'gps'->'GPSLongitude'->1)::text::float / 60 + 
            (file.exif->'gps'->'GPSLongitude'->2)::text::float / 3600,
            (file.exif->'gps'->'GPSLatitude'->0)::text::float + 
            (file.exif->'gps'->'GPSLatitude'->1)::text::float / 60 + 
            (file.exif->'gps'->'GPSLatitude'->2)::text::float / 3600
          ), 4326)::geography,
          ST_SetSRID(ST_MakePoint(:GPSLongitude, :GPSLatitude), 4326)::geography
        )
      `, 'ASC')
      .setParameters({ 
        GPSLatitude: this.arrayToDD(GPSLatitude),
        GPSLongitude: this.arrayToDD(GPSLongitude)
      })
      .limit(limit)
      .getMany();
    
    this.logger.log('\n### getNearbyImages 结果数量：' + nearbyImages.length);

    const imagesData = nearbyImages.map((file) => {
      const path = file.path.replace(/\\/g, '/');
      const trimmedPath = path.replace(/^.*?(\/[^/]+\/[^/]+\/[^/]+)$/, '$1');
      const formattedPhotoTime = file.photo_time ? this.formatPhotoTime(file.photo_time) : ' ';
      return {
        fId: file.fId,
        fileName: file.fileName,
        path: trimmedPath,
        url: `${configService.getHostName()}/api/v1/file/${file.fId}/download`,
        photo_time: formattedPhotoTime,
        exif: file.exif || ' ',
      };
    });


    // print current currentImage info
    console.log(`### currentImage fId: ${currentImage.fId},  ### path: ${currentImage.path},   ### photo_time: ${currentImage.photo_time},   ### GPSLatitude: ${(currentImage.exif as any)?.gps?.GPSLatitude ?? 'N/A'},   ### GPSLongitude: ${(currentImage.exif as any)?.gps?.GPSLongitude ?? 'N/A'} `);
    imagesData.forEach((item) => {
    console.log(`### nearbyImages fId: ${item.fId},  ### path: ${item.path},   ### photo_time: ${item.photo_time},   ### GPSLatitude: ${(item.exif as any)?.gps?.GPSLatitude ?? 'N/A'},   ### GPSLongitude: ${(item.exif as any)?.gps?.GPSLongitude ?? 'N/A'} `);
    });
    return imagesData;
  }

  private arrayToDD(coords: any[]): number {
    if (!Array.isArray(coords) || coords.length !== 3) {
      throw new Error('无效的 GPS 坐标格式');
    }
    const [deg, min, sec] = coords.map(val => {
      if (val === null || val === 'null' || isNaN(parseFloat(val))) {
        throw new Error('GPS 坐标包含无效值');
      }
      return parseFloat(val);
    });
    return deg + min / 60 + sec / 3600;
  }

  public async getAllImagesWithGPS(): Promise<any[]> {
    this.logger.log('\n\n### getAllImagesWithGPS');
    const files = await this.fileRepository
      .createQueryBuilder('file')
      .where(`
        file.exif->'gps'->'GPSLatitude' IS NOT NULL AND
        file.exif->'gps'->'GPSLongitude' IS NOT NULL AND
        jsonb_array_length(file.exif->'gps'->'GPSLatitude') = 3 AND
        jsonb_array_length(file.exif->'gps'->'GPSLongitude') = 3 AND
        (file.exif->'gps'->'GPSLatitude'->0)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->1)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->2)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->0)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->1)::text != 'null' AND
        (file.exif->'gps'->'GPSLongitude'->2)::text != 'null' AND
        (file.exif->'gps'->'GPSLatitude'->0)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLatitude'->1)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLatitude'->2)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->0)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->1)::text::float IS NOT NULL AND
        (file.exif->'gps'->'GPSLongitude'->2)::text::float IS NOT NULL
      `)
      .select(['file.fId', 'file.fileName', 'file.path', 'file.exif'])
      //.take(2000)
      .getMany();

    this.logger.log('\n### getAllImagesWithGPS 原始结果数量：' + files.length);
    
    const validFiles = files.filter(file => {
      try {
        const { GPSLatitude, GPSLongitude } = file.exif['gps'];
        const lat = this.arrayToDD(GPSLatitude);
        const lon = this.arrayToDD(GPSLongitude);
        return this.isValidCoordinate(lat, lon);
      } catch (error) {
        this.logger.warn(`无效的GPS数据 fId: ${file.fId}, 文件名: ${file.fileName}`);
        return false;
      }
    });
   
    const returnLimit = 5000;
    this.logger.log('\n### getAllImagesWithGPS 有效结果数量：' + validFiles.length + ' 返回Map 限制数量：' + returnLimit);
    return validFiles.reverse().slice(0, returnLimit).map(file => {
      const { GPSLatitude, GPSLongitude } = file.exif['gps'];
      return {
        fId: file.fId,
        fileName: file.fileName,
        path: file.path,
        coordinates: [
          this.arrayToDD(GPSLatitude),       //######### 当地图显示不正常时， 请检查 Latitude 在 前面！！
          this.arrayToDD(GPSLongitude),
        ]
      };
    });
  }

  private isValidCoordinate(lat: number, lon: number): boolean {
    return (
      !isNaN(lat) && !isNaN(lon) &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180
    );
  }

 
}