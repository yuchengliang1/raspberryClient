const fs = require("fs");
var exec = require('child_process').execSync;
var pty = require('node-pty');
var os = require('os');
const io = require('socket.io-client');
var shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const DEVICENAME = 'raspberry1';
var rpio = require('rpio');
var pin = 7;
function read_dht11(vals)
{
	var data = new Array(40);
	var buf = new Buffer(50000);
	rpio.open(pin, rpio.OUTPUT, rpio.HIGH);
	rpio.write(pin, rpio.LOW);
	rpio.msleep(18);
	rpio.mode(pin, rpio.INPUT, rpio.PULL_UP);
	rpio.readbuf(pin, buf);
	rpio.close(pin);
	var dlen = 0;
	buf.join('').replace(/0+/g, '0').split('0').forEach(function(bits, n) {
		if (n < 2 || n > 41)
			return;

		data[dlen++] = bits.length;
	});
	if (dlen < 39)
		return false;
	var low = 10000;
	var high = 0;
	for (var i = 0; i < dlen; i++) {
		if (data[i] < low)
			low = data[i];
		if (data[i] > high)
			high = data[i];
	}
	var avg = (low + high) / 2;
	vals.fill(0);
	for (var i = 0; i < dlen; i++) {
		var group = parseInt(i/8)

		/* The data is in big-endian format, shift it in. */
		vals[group] <<= 1;

		/* This should be a high bit, based on the average. */
		if (data[i] >= avg)
			vals[group] |= 1;
	}
	console.log('success');
	return (vals[4] == ((vals[0] + vals[1] + vals[2] + vals[3]) & 0xFF));
}
function getData () {
	var systemData = {};
	var tempStr = exec('vcgencmd measure_temp');
	var temp = String(tempStr).replace("temp=","").replace("'C\n","");
	var p = String(exec('free -m'));
	var pattern = /[1-9]\d*/g;
	var matches =  p.match(pattern);
	var d = String(exec("df -h /"));
	var dpattern = /[0-9]+([.]{1}[0-9]+){0,1}/g;
	var dmatches = d.match(dpattern);
	systemData.temp = temp;
	systemData.memTotal = matches[0];
	systemData.memUsed = matches[1];
	systemData.memFree = matches[2];
	systemData.diskTotal = dmatches[0];
	systemData.diskUsed = dmatches[1];
	systemData.diskFree = dmatches[2];
	systemData.diskPer = dmatches[3];
	var v = Buffer(5);
	if (read_dht11(v)) {
		systemData.temperature = v[2];
		systemData.humidity = v[0];
	}
	systemData.devicename = DEVICENAME;
	return systemData;
}
const socket = io.connect('http://138.128.214.158:3035');
const defaultUrl = '/home/pi';
function writeLog(data) {
    fs.writeFile('./test.txt',data+'\n',{'flag':'a'},function (err) {
        if(err) {
            throw err;
        }
    });
}
var ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env
});
ptyProcess.on('data', function(data) {
    writeLog('树莓派发出的数据:  \n'+data);
    let res = {};
    res.data = data;
    res.origin = DEVICENAME;
    socket.emit('cmd_res',res);
});
socket.on('cmd_ls',(req)=>{
    if(req.target==DEVICENAME)
    {
    	writeLog('服务器传来的命令数据: '+req.data);
    	ptyProcess.write(req.data+'\r');
    }
});
socket.on('dir_req',(req)=>{
    if(req.target==DEVICENAME)
    {
	    let files = [];
	    let directories = [];
	    try {
		const filelist = fs.readdirSync(req.data);
		filelist.forEach(function(item,index){
		    let stat = fs.lstatSync(req.data+'/'+item);
		    if(stat.isFile()&&item[0]!='.'){
		        files.push(item);
		    }
		    if(stat.isDirectory()&&item[0]!='.'){
		        directories.push(item);
		    }
		});
		let res = {};
		res.files = files;
		res.directories = directories;
		res.origin = DEVICENAME;
		writeLog('服务器希望查看的路径相关信息: '+req.data);
		socket.emit('dir_res_p',res);
	    }
	    catch (err) {
		writeLog('服务器读取路径失败');
		const filelist = fs.readdirSync(defaultUrl);
		filelist.forEach(function(item,index){
		    let stat = fs.lstatSync(defaultUrl+'/'+item);
		    if(stat.isFile()&&item[0]!='.'){
		        files.push(item);
		    }
		    if(stat.isDirectory()&&item[0]!='.'){
		        directories.push(item);
		    }
		})
		let res = {};
		res.files = files;
		res.directories = directories;
		res.origin = DEVICENAME;
		socket.emit('dir_res_p',res);
	    }
    }
});
socket.on('create_dir',function(req){
    if(req.target==DEVICENAME)
    {
	    writeLog('服务器希望新建的目录位置: '+req.data);
	    try {
		fs.mkdir(req.data,{recursive: false},(err)=>{
		    if(err) {
		        let res = {};
		        res.origin = DEVICENAME;
		        res.success = 0;
		        socket.emit('created_dir',res);
		        writeLog('目录创建失败');
		    }   else {
		        let res = {};
		        res.origin = DEVICENAME;
		        res.success = 1;
		        socket.emit('created_dir',res);
		        writeLog('目录创建成功');
		    }
		});
	    } 
	    catch (err) {
		let res = {};
		res.origin = DEVICENAME;
		res.success = 0;
		socket.emit('created_dir',res);
		writeLog('目录创建失败');
	    }
    }
});
socket.on('delete_file',function(req){
    if(req.target==DEVICENAME)
    {
	    writeLog('服务器想要删除的文件为: '+req.data);
	    fs.unlink(req.data,function(err){
		if(err) {
		    let res = {};
		    res.origin = DEVICENAME;
		    res.success = 0;
		    socket.emit('deleted_file',res);
		    writeLog('文件删除失败');
		}   else {
		    let res = {};
		    res.origin = DEVICENAME;
		    res.success = 1;
		    socket.emit('deleted_file',res);
		    writeLog('文件删除成功');
		}
	    })
     }
});
socket.on('file_upload',function(data){
    writeLog('服务器target为: '+data.target);	
    if(data.target==DEVICENAME)
    {
        writeLog('服务器想要上传的文件为: '+data.url);
        fs.writeFile(data.url,data.fileData,{'flag':'a'},function (err) {
            if(err) {
                socket.emit('upload_res_p',0);
                throw err;
            } else {
                writeLog('接受上传文件成功');
                socket.emit('upload_res_p',1);
            }
        });
    }
});
socket.on('file_download',function(req){
    if(req.target==DEVICENAME)
    {
        writeLog('服务器想要下载的文件为: '+req.url);
        writeLog(req.url+'is trying to read');
        fs.readFile(req.url,function (err,data) {
	    writeLog(req.url+'is reading');
            if(err) {
                let res = {};
                res.origin = DEVICENAME;
                res.success = 0;
                socket.emit('download_res_p',res);
                throw err;
            } else {
                let res = {};
                res.origin = DEVICENAME;
                let filename=req.url.slice(req.url.lastIndexOf('/')+1);
                res.name = filename;
                res.filedata = data;
                writeLog('下载文件'+filename+'发送成功');
                socket.emit('download_res_p',res);
            }
        });
    }
});
function sendSystem() {
    var data = getData();
    socket.emit('system_data_p',data);
}
setInterval(sendSystem,10000);