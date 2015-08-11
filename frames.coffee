require 'shelljs/global'

arg = require 'commander'

arg
	.option('-i, --input <input>', 'Input', '')
	.option('-o, --output <output>', 'Output', '')
	.option('-f, --framerate <framerate>', 'Framerate', 24)
	.option('-d, --duration <duration>', 'Duration', '')
	.parse(process.argv)

mkdir '-p', arg.output

cmds = []

cmds.push "ffmpeg -i #{arg.input} -r #{arg.framerate} -t #{arg.duration} -q:v 1 -f image2 #{arg.output}/%01d.jpg"
cmds.push "ffmpeg -i #{arg.input} -t #{arg.duration} -vn -acodec copy #{arg.output}/audio.aac " 
cmds.push "ffmpeg -i #{arg.input} -t #{arg.duration} -vn -b:a 192K #{arg.output}/audio.mp3 " 
cmds.push "ffmpeg -i #{arg.input} -t #{arg.duration} -vn -acodec libvorbis #{arg.output}/audio.ogg " 

num_cmds = cmds.length
progress = 0

run = (cmds) =>

	if cmds.length is 0
		return echo 'done'

	echo "Progress #{progress} / #{num_cmds}"

	cmd = cmds.shift()

	exec cmd, (code, output) ->
		# console.log('Exit code:', code);
		# console.log('Program output:', output);
		progress++
		run cmds

run cmds