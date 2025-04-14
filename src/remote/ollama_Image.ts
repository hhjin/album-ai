import * as fs from 'fs';

interface ClassificationResult {
  response?: string;
  error?: string;
}

/**
 * Classify images using the Ollama API.
 * @param imagePath: The path of the image file.
 * @param model: The Ollama model to be used (default is "llava").
 * @returns Promise<ClassificationResult>: An object containing the classification results, and if an error occurs, an error message will be returned.
 */
async function classifyImage(
  url: string, 
  model: string ,
  prompt:string,
  imageBase64: string,
): Promise<ClassificationResult> {
  await new Promise((resolve) => setTimeout(resolve, 10000)); 
  const maxRetries = 5; //The maximum number of retries is set to 1 here, and you can adjust it according to actual requirements.
  let retries = 0; // current retry times
  const logFilePath = 'ollama_image_classification.log'; 
  const appendToLogFile = (message: string) => {
    console.log(message)
    fs.appendFileSync(logFilePath, message + '\n');
  };
  let retryInterval = 50000; // 初始重试间隔，单位毫秒
  while (retries <= maxRetries) {
    try {
 
      const data = {
        model,
        prompt,
        images: [imageBase64],
        stream: false, //Get the complete response instead of the streaming response.
      };
  
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
  
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} - ${await response.text()}`);
      }
  
      const responseText = await response.text();
      const result = JSON.parse(responseText);
      const resultText=result.response;
      appendToLogFile("### responseText :\n"+resultText)
      return resultText;
  
    } catch (e) {
      if (e instanceof Error) {
        if (retries < maxRetries && e.message.includes('fetch failed')) { // Judge whether it is a network-related error and the maximum number of retries has not been reached.
          const retryMessage = `Network error occurred, retrying (${retries + 1}/${maxRetries})...`;
          console.error(retryMessage);
          appendToLogFile(retryMessage);
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
          retries++;
          retryInterval += 5000; // 每次重试后间隔时间增加 5 秒
          continue; //Proceed with the next retry.
          //return { error: retryMessage };
        }else if (retries >= maxRetries && e.message.includes('fetch failed')) {
          //If it still fails when the number of retries has been used up, then return this error message.
          const maxRetriesExceededMessage = `Max retries exceeded, unable to complete the request: ` ;
          console.error(maxRetriesExceededMessage);
          appendToLogFile(maxRetriesExceededMessage);
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
          return { error: maxRetriesExceededMessage };
        }else{
          const errorMessage = `Error: ${e.message}`;
          console.error(errorMessage);
          appendToLogFile(errorMessage);
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
          return { error: e.message };
        }
      }
      const unknownErrorMessage = `Unknown error!`;
      console.error(unknownErrorMessage);
      appendToLogFile(unknownErrorMessage);
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
      return { error: 'Unknown error !' };
    }
  }
  //If it still fails when the number of retries has been used up, then return this error message.
  const maxRetriesExceededMessage = `Max retries exceeded, unable to complete the request.`;
  console.error(maxRetriesExceededMessage);
  appendToLogFile(maxRetriesExceededMessage);
  return { error: maxRetriesExceededMessage };
};


export { classifyImage };
export type { ClassificationResult }; 