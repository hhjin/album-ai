import os
import shutil



def get_all_files(folder):
    file_list = []
    for root, _, files in os.walk(folder):
        for file in files:
            file_list.append((file, os.path.join(root, file)))
    return file_list

def compare_and_copy(folder1, folder2, folder3):
    # 确保目标文件夹存在
    if not os.path.exists(folder3):
        os.makedirs(folder3)

    # 获取两个文件夹中的所有文件（包括子目录）
    files1 = get_all_files(folder1)
    files2 = set(os.path.basename(f) for _, f in get_all_files(folder2))

    # 找出在文件夹一中存在但在文件夹二中不存在的文件
    files_to_copy = [(name, path) for name, path in files1 if name not in files2]

    # 复制文件
    for name, src_path in files_to_copy:
        dst = os.path.join(folder3, name)
        
        # 如果目标文件已存在，添加数字后缀
        counter = 1
        while os.path.exists(dst):
            name, ext = os.path.splitext(name)
            dst = os.path.join(folder3, f"{name}_{counter}{ext}")
            counter += 1
        
        shutil.copy2(src_path, dst)
        print(f"已复制: {name} -> {dst}")

    print(f"共复制了 {len(files_to_copy)} 个文件到 {folder3}")



#把文件夹一存在但 文件夹二中不存在的文件拷贝出来到文件夹三中间

folder1 = "/Users/henryking/Pictures/图像合辑/Picture"
folder2 = "/Users/henryking/Pictures/图像合辑/photo_seletedsince2009"
folder3 = "/Users/henryking/Pictures/图像合辑/NotinPicture222"

compare_and_copy(folder1, folder2, folder3)