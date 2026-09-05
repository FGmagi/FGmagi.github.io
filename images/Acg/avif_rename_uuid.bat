@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 正在将当前文件夹下的 .avif 文件重命名为 UUID...
echo 已符合 UUID 格式的文件将自动跳过
echo.

set count=0
set skipcount=0

for %%f in (*.avif) do (
    set "filename=%%~nf"
    
    REM 检查文件名是否已经是 UUID 格式（8-4-4-4-12）
    echo !filename! | findstr /r "^[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{12\}$" >nul
    
    if !errorlevel! equ 0 (
        set /a skipcount+=1
        echo 跳过: %%f ^(已是 UUID 格式^)
    ) else (
        set /a count+=1
        call :generate_uuid
        
        REM 检查目标文件是否已存在
        if not exist "!uuid!.avif" (
            ren "%%f" "!uuid!.avif"
            if !errorlevel! equ 0 (
                echo 成功: %%f -^> !uuid!.avif
            ) else (
                echo 失败: %%f ^(重命名失败^)
            )
        ) else (
            REM 极低概率冲突，加随机后缀
            set /a suffix=!random!
            ren "%%f" "!uuid!_!suffix!.avif"
            echo 冲突处理: %%f -^> !uuid!_!suffix!.avif
        )
    )
)

echo.
echo ========================================
echo 处理完成！
echo 已处理（重命名）: %count% 个
echo 已跳过（已是UUID）: %skipcount% 个
echo ========================================
pause
exit /b

:generate_uuid
set "uuid="
for /l %%i in (1,1,32) do (
    set /a r=!random! %% 16
    if !r! equ 10 set r=a
    if !r! equ 11 set r=b
    if !r! equ 12 set r=c
    if !r! equ 13 set r=d
    if !r! equ 14 set r=e
    if !r! equ 15 set r=f
    set "uuid=!uuid!!r!"
)
set "uuid=!uuid:~0,8!-!uuid:~8,4!-!uuid:~12,4!-!uuid:~16,4!-!uuid:~20,12!"
exit /b