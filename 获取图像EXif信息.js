const fs = require('fs');
const ExifImage = require('exif').ExifImage;

function getExifData(imagePath) {
  try {
    new ExifImage({ image: imagePath }, function (error, exifData) {
      if (error) {
        console.log('Error: ' + error.message);
      } else {
        console.log(exifData); // 打印所有EXIF数据
        console.log(`\n ##### 获取图像EXif信息  ${imagePath}  :\n${exifData} \n\n`);
      }
    });
  } catch (error) {
    console.log('Error: ' + error.message);
  }
}


function checkExifHeader(imagePath) {
  const buffer = Buffer.alloc(10);
  const fd = fs.openSync(imagePath, 'r');
  fs.readSync(fd, buffer, 0, 10, 0);
  fs.closeSync(fd);

  console.log(buffer.toString('hex'));
  // EXIF数据应该以 "FFD8FFE1" 开头，后面紧跟 "457869660000" (Exif..)
}

// 使用函数
getExifData('/Users/henryking/Desktop/AI/album-ai/imagesBAK/IMG_20230228_100446.jpg')
getExifData('/Users/henryking/Desktop/AI/album-ai/imagesBAK/photo_seletedsince2009-2/P4240248.JPG')