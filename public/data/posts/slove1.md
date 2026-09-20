---

title: "刷题笔记"

published: 2026-07-08

active: true

draft: false

pinned: false

description: "暴力出奇迹，打表出AC"

tags: [“技术”,"笔记"]

width: 0.5

category: ""

licenseName: "MIT"

author: "FGmagi"

sourceLink: "[fgmagi.pages.dev](https://fgmagi.pages.dev/)"

image: './image/希绮菈.webp'

image_mode: 'up'

---

## 二维背包问题

有限背包，有dp[i-1,j-w]+v确定，无限背包，由dp[i,j-w]+v确定

```python
import numpy as np
from numba import njit
def slove():
    H,W,N = map(int,input().split())
    data = []
    for _ in range(N):
        data.append(list(map(int,input().split())))
    data=np.array(data)
    shape = (N+1,H+1,W+1)
    dp = np.zeros(shape)
    run(dp,data,H,W)
    print(int(dp.max())) 

@njit
def run(dp,data,H,W):
    for i,j,k in np.ndindex(dp.shape):
        if i == 0 or (j ==0 and k ==0):
            dp[i,j,k] = 0
            continue
        # 当前物品数据
        h,w,v = data[i-1]
        pri = 0
        if j>=h and k >= w:
            pri = dp[i-1,j-h,k-w] + v
        dp[i,j,k] = max(dp[i-1,j,k],pri)


slove()
```

## 24点

输入四个数字，判断仅通过加减乘除、括号、位置移动，是否能构成24点。

```python
nums = list(input().split())
vis = [0] * 4
tool = ["+","-","*","/"]

def dfs(nums):
    if len(nums) == 1:
        return abs(float(nums[0]) - 24) < 1e-4
    for i_,i in enumerate(nums):
        for j_,j in enumerate(nums):
            if i_ != j_:
                for k in tool:
                    try:
                        temp = str(eval(i+k+j))
                    except Exception:
                        continue
                    next_nums = [nums[l_] for l_ in range(len(nums)) if l_ !=i_ and l_ != j_]
                    next_nums.append(temp)
                    result = dfs(next_nums)
                    if result == True:
                        return True
                    else:
                        continue
    return False

print("true" if dfs(nums) else "false")
```

## bfs

```python
def slove():
    h,w = input().split()
    h,w = int(h),int(w)
    map = []
    for r in range(h):
        t = input().split()
        t = [int(n) for n in t]
        map.append(t)
    path = bfs(map)
    for r,c in path:
        print(f"({r},{c})")

#检查是否合法移动
def check(r,c,map):
    if 0<=r<len(map) and 0<=c<len(map[0]) and map[r][c] == 0:
        return True
    else:
        return False

def bfs(map)->list:
    from collections import deque
    queue = deque()
    queue.append([0,0,[[0,0]]])
    vis = []
    for r in range(len(map)):
        vis.append([False]*len(map[0]))
    while queue:
        r,c,path = queue.popleft()
        dir = [[1,0],[0,1],[-1,0],[0,-1]]
        for dr,dc in dir:
            nr,nc = r+dr,c+dc
            if check(nr,nc,map) and vis[nr][nc] == False:
                vis[nr][nc] = True
                path.append([nr,nc])
                queue.append([nr,nc,path.copy()]) 
                if nr == len(map)-1 and nc == len(map[0])-1:
                    return path
                path.pop()
    return []

slove()
```

## 素数伴侣

```python
from typing import List

# 奇数集合
class Odds:
    def __init__(self,id,v) -> None:
        self.id:int = id
        self.val:int = v 
        self.could_mat:List[int] = []#所有可以匹配的偶数下标集
# 偶数集合
class Evens:
    def __init__(self,id,v) -> None:
        self.id:int = id
        self.val:int = v
        self.is_mating:int = -1#正在和哪个下标的奇数匹配
        self.is_vising:bool = False#是否正在轮询中

#全局变量
class data:
    n = 0 #变量总数
    s = [] #变量列表

# 素数筛
prime_data = [True] * (60001)
def is_prime(n):
    if prime_data[0] == True:
        prime_data[0] = prime_data[1] = False
        for i in range(2,60001):
            if i*i > 60000:
                break
            for j in range(i,60001):
                if i*j > 60000:
                    break
                else:
                    prime_data[i*j] = False
    return prime_data[n]

def slove():
    data.n = int(input())
    data.s = input().split()
    data.s = [int(i) for i in data.s]
    odds:List[Odds] = []
    evens:List[Evens] = []
    for i,v in enumerate(data.s):
        if ((v >> 1) << 1) == v:
            evens.append(Evens(len(evens),v))
        else:
            odds.append(Odds(len(odds),v))
    
    for i,A in enumerate(odds):
        for j,B in enumerate(evens):
            if is_prime(A.val+B.val):
                A.could_mat.append(j)
    for i,A in enumerate(odds):
        find(A,odds,evens)
    s = 0
    for j,B in enumerate(evens):
        if B.is_mating != -1:
            s += 1
    
    print(s)

#查询odd是否可以匹配evens，或是否可以换一个匹配
def find(odd:Odds,odds:List[Odds],evens:List[Evens]):
    i,A = odd.id,odd
    for j in odd.could_mat:
        B = evens[j]
        if B.is_vising == False:
            if B.is_mating == -1:
                B.is_mating = i
                return True
            else:
                C = B.is_mating
                B.is_vising = True
                if find(odds[C],odds,evens):
                    B.is_mating = i
                    B.is_vising = False
                    return True
                else:
                    continue
    return False

slove()
```

## 兄弟字符串

```python

def solve():
    l = input()
    l = l.split()
    n = int(l[0])
    s = []
    for i in range(1,n+1):
        s.append(l[i])
    x = l[-2]
    k = int(l[-1])

    count = countStr(x)
    result = [i for i in s if check(i,x,count)]
    output(result,k)

# 统计x各字母次数
def countStr(x:str):
    count = [0]*255
    for c in x:
        count[ord(c)] += 1

    return count

# 判断是否为兄弟单词
def check(s,x,count):
    count2 = count.copy()
    if s == x:
        return False
    if len(s) != len(x):
        return False

    for c in s:
        count2[ord(c)] -= 1
        if count2[ord(c)] < 0:
            return False
    return True
# 排序并输出
def output(result,k):
    print(len(result))
    try:
        result = sorted(result)
        print(result[k-1])
    except Exception:
        pass

solve()
```

## 数独

### 解
```python
# 获取输入
def getMat() -> list:
    mat = []
    for i in range(9):
        a = input().split()
        a = [int(n) for n in a]
        mat.append(a)
    return mat

# 检查在 (r, c) 填入 val 是否合法
def isValid(r, c, val, mat):
    for i in range(9):
        # 检查行
        if mat[r][i] == val: return False
        # 检查列
        if mat[i][c] == val: return False
        # 检查 3x3 九宫格
        if mat[(r // 3) * 3 + i // 3][(c // 3) * 3 + i % 3] == val: return False
    return True

# 递归回溯求解
def solveDFS(mat) -> bool:
    for r in range(9):
        for c in range(9):
            if mat[r][c] == 0:  # 找到一个空格
                for val in range(1, 10):  # 尝试填入 1~9
                    if isValid(r, c, val, mat):
                        mat[r][c] = val  # 尝试填入
                        
                        if solveDFS(mat):  # 递归下一层
                            return True
                        
                        mat[r][c] = 0  # 【核心】回溯，恢复原样
                return False  # 1~9 都填不进去，说明之前的路走错了
    return True  # 所有格子都填满了，成功

def solve():
    mat = getMat()
    if solveDFS(mat):
        for r in range(9):
            s = (str(i) for i in mat[r])
            print(" ".join(s))
    else:
        print("无解")

if __name__ == "__main__":
    solve()
```


## 前缀和

前缀和 + 动态规划/计数优化

### 描述

小红有一个长度为 n 的数组 {a1,a2,…,an}{a1​,a2​,…,an​} ，她打算将数组切两刀变成三个非空子数组，使得每一个子数组中至少存在一个正数，且每个子数组的和都相等。  
看起来不是很难，所以小红想让你求解，一共有多少种不同的切分方案。

第一行输入两个整数 n(3≦n≦2×105)n(3≦n≦2×105) 代表数组中的元素数量。  
第二行输入 nn 个整数 a1,a2,…,an(−109≦ai≦109)a1​,a2​,…,an​(−109≦ai​≦109) 代表数组元素。

在一行上输出一个整数，代表切分方案数。

输入：
3
3 3 3

输出：
1

输入：
6
1 1 4 5 1 4

输出：
0

输入：
10
0 3 4 2 3 2 1 -1 3 4

输出：
2

### 解

```
#pos[i]表示vec[0:i]内正数个数
#sss[i]表示vec[0:i]内元素之和
def solve():
    pos = []
    sss = []
    n = input()
    n = int(n)
    vec = input().split()
    vec = [int(i) for i in vec]

    if vec[0]>0:
        pos.append(1)
    else:
        pos.append(0)
    sss.append(vec[0])

    for i in range(1,n):
        if (vec[i] > 0):
            pos.append(pos[-1]+1)
        else:
            pos.append(pos[-1])
        sss.append(sss[i-1]+vec[i])

    s = sss[-1] // 3
    if sss[-1]%3 != 0:
        print(0)
        return

    test_first_cut = []
    test_second_cut = []
    for i in range(0,n):
        if sss[i] == s:
            test_first_cut.append(i)       
        if sss[i] == 2*s:
            test_second_cut.append(i)

    true_count = 0
    for i in test_first_cut:
        if i == len(vec):
            continue
        if pos[i] == 0:
            continue
        for j in test_second_cut:
            if pos[i] < pos[j] and pos[j] < pos[-1]:
                true_count +=1
                continue

    print(true_count)

solve()
```

## 找零问题

```
n = [1,2,5,10,20,50,100]
money = 7999
ds = [float('inf')]*max(max(n)+1,money+1)

def slove():
    #ds[i]表示需要多少张钱币，才能给i元找零
    ds[0]=0

    #money可以用哪些钱币找零
    use = []
    for i in n:
        ds[i] = 1
        if money == i:
            print(1)
            return
        if i <= money:
            use.append(i)
    
    for i in range(3,money+1):
        for j in use:
            if i-j > 0:  
                ds[i] = min(ds[i],ds[i-j]+1)
    print(ds[money])

slove()
```

## 贪吃蛇

果然还是写游戏我擅长

```
from collections import deque

order = "UGDGGLGGRGUGG"
N,M = 3,3
ar = [
['F','F','F'],
['F','F','H'],
['E','F','E']
]

class Sne:
    def __init__(self) -> None:
        self.r:int = 0
        self.c:int = 0
        self.dir:str = "L"
        self.body:deque = deque()
        self.alive:bool = True

#设置出生点
def setStartPos(sne:Sne):
    for r in range(N):
        for c in range(M):
            if ar[r][c] == "H":
                sne.r = r
                sne.c = c
                sne.body.append((r,c))
    
#检查地图状态，有没有吃东西，有没有撞到东西。
def checkMap(sne:Sne):
    q = sne.body.popleft()
    if not (0<=sne.r<N and 0<=sne.c<M):
        sne.alive = False
        return
    if ar[sne.r][sne.c] == "F":
        sne.body.appendleft(q)
        ar[sne.r][sne.c] = "E"
    for i in range(0,len(sne.body)-1):
        tr,tc = sne.body[i]
        if tr == sne.r and tc == sne.c:
            sne.alive = False
            return

#向前移动
def move(sne:Sne):
    dr,dc = 0,0
    dir = sne.dir
    if dir == "U":
        dr = -1
    if dir == "D":
        dr = 1
    if dir == "L":
        dc = -1
    if dir == "R":
        dc = 1
    sne.r += dr
    sne.c += dc
    sne.body.append((sne.r,sne.c))
    checkMap(sne)

#解析指令
def run(sne:Sne,cmd:str):
    if cmd =="G":
        move(sne)
    else:
        sne.dir = cmd

def slove():
    sne = Sne()
    setStartPos(sne)
    for c in order:
        run(sne,c)
        if sne.alive == False:
            break
    print(len(sne.body))


slove()
```

## 服务器连线

### 题目描述

实质是图的遍历，求连通分量的个数；  
做这道题的时候没想到遍历该怎么写，用了比较麻烦的方法；  
用一个 `Set` 存储一个连通分量，将它们保存到数组中，数组的长度就是连通分量的个数，即本题的答案；  
具体做法是：遍历整个邻接矩阵，每遍历到新的一行，判断当前节点是否已经存在于某个已有的连通分量，如果有，将与其直接连接的节点存到该连通分量；如果没有，新建一个 `Set` （新连通分量）进行存储，最后得到整个连通分量的数组，用 `Set` 是保证没有重复，数组也可

### 解
```
# 路径压缩
def find(table,targe):
    root = table[targe]
    while root != table[root]:
        root = table[root]
    c = targe
    while c != root:
        c,table[c] = table[c],root
    return root

def solve(mat):
    table = [ i for i in range(len(mat[0]))]
    recode = {}
    for r in range(len(mat)):
        for c in range(len(mat[r])):
            if mat[r][c] == 1:
                a = find(table,r)
                b = find(table,c)
                if a != b:
                    table[b] = a

    result = set([find(table,i) for i in range(len(table))])
    print(len(result))

mat = [[1,0,1,0,1,1],[0,1,0,0,0,0],[1,0,1,0,0,0],[0,0,0,1,0,0],[1,0,0,0,1,0],[1,0,0,0,0,1]]
solve(mat)

```

## 解压报文

### 题目描述

为了提升数据传输的效率，会对传输的报文进行压缩处理。输入一个压缩后的报文，请返回它解压后的原始报文。  

压缩规则：n[str]，表示方括号内部的 str 正好重复 n 次。注意 n 为正整数（0 < n <= 100），str只包含小写英文字母，不考虑异常情况。  

输入压缩后的报文：  
1）不考虑无效的输入，报文没有额外的空格，方括号总是符合格式要求的；  
2）原始报文不包含数字，所有的数字只表示重复的次数 n ，例如不会出现像 5b 或 3[8] 的输入；  

输出解压后的原始报文  

注：原始报文长度不会超过1000，不考虑异常的情况  

示例1：  
输入：
3[k]2[mn]  
输出：
kkkmnmn  

示例2：
输入：
3[m2[c]]  
输出：
mccmccmcc  

### 解
```
def unpack(s:str)->str:
    stack = []
    num = 0
    now = ""
    for c in s:
        if c.isdigit():
            num = num*10+int(c)
        elif c == "[":
            stack.append((num,now))
            num,now = 0,"" 
        elif c == "]":
            a,b = stack.pop()
            now = b + a*now
        else:
            now += c 
    return now
print(unpack("3[k]2[mn]"))
print(unpack("3[m2[c]]"))
```

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))
```

## 求二叉树的后序遍历

已知先序遍历和中序遍历，求二叉树的后序遍历

原题链接：https://www.cnblogs.com/gcter/p/15469584.html

### 题目描述

有一棵二叉树，每个节点由一个大写字母标识(最多26个节点）。现有两组字母，分别表示前序遍历（父节点->左孩子->右孩子）和中序遍历（左孩子->父节点->右孩子）的结果，请你输出后序遍历（左孩子->右孩子->父节点）的结果。

解答要求时间限制：1000ms, 内存限制：100MB

输入：
每个输入文件包含两串字母，各占一行。（每串只包含大写字母）  
第一行字母表示前序遍历结果，第二行字母表示中序遍历结果。

输出：
输出仅一行，表示后序遍历的结果，结尾换行。

样例：
输入：
DBACEGF
ABCDEFG

输出：
ACBFGED

### 解：
```python
from dataclasses import dataclass
from typing import Optional
  
@dataclass
class Tree:
    value:str = ""
    left: Optional['Tree'] = None
    right: Optional['Tree'] = None
    par: Optional['Tree'] = None
  
def solve():
    font = input()
    mid = input()
    root:Tree = getTree(None,font,mid)
    output(root)
  
def output(root):
    if root == None:
        return
    output(root.left)
    output(root.right)
    print(root.value,end="")
  
def getTree(par,font,mid)->Optional[Tree]:
    if len(font) == 0:
        return None
    root = Tree()
    root.value = font[0]
    root.par = par
    t = mid.index(root.value)
    mid_left = mid[0:t]
    mid_right = mid[t+1:]
    font_left = font[1:t+1]
    font_right = font[t+1:]
    root.left = getTree(root,font_left,mid_left)
    root.right = getTree(root,font_right,mid_right)
    return root
solve()
```

## 进制转换7

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换8

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换555

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换666

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))

## 进制转换

```
t = "0xff"
print(int(t,16))

a:int = 255
print("{:b}".format(a))
print("{:o}".format(a))
print("{:x}".format(a))