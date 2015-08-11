shelljs = require 'shelljs/global'
arg     = require 'commander'

arg
	.option('-s, --source <source>', 'Source', '')
	.option('-o, --output <output>', 'Output', '')
	.option('-f, --framesperpack <framesperpack>', 'Frames per pack', '')
	.option('-r, --resize <resize>', '100', '')
	.option('-t, --type <type>', '', '')
	.option('-w, --width <width>', 'Original width', '')
	.option('-h, --height <height>', 'Original height', '')
	.option('-e, --extension <extension>', 'File extension', 'jpg')
	.option('-d, --duration <duration>', 'Video duration', 1)
	.parse(process.argv)

pack_images = ( dir, width, height ) ->

	console.log arg.duration

	cmd = "python packImages.py --src #{dir} --out #{arg.output} --width #{width} --height #{height} --duration #{arg.duration} --imagesperpack #{arg.framesperpack}"

	exec cmd, (code, output) ->

		# echo 'Exit code:', code
		# echo 'Program output:', output

		# Remove the tmp directory
		rm '-rf', dir

# pack_images '_1439203061015_sd'
# return

process_images = ->

	# if not test '-d', arg.output
	# 	mkdir arg.output

	# Create a tmp directory
	tmp_dir = '_' + String(Date.now()) + '_' + arg.type

	mkdir '-p', tmp_dir

	# Copy all source images to tmp directory
	cp '-R', "#{arg.source}/*", tmp_dir

	# Generate a list of commands to resize the images
	cmds = []
	remFiles = []

	WIDTH  = parseInt(arg.width)  * parseFloat(arg.resize / 100)
	HEIGHT = parseInt(arg.height) * parseFloat(arg.resize / 100)

	for file, i in ls "#{tmp_dir}/*.jpg"

		switch arg.extension

			when 'webp'

				outfile = file.replace('.jpg', '.webp')

				cmds.push "cwebp -resize #{WIDTH} #{HEIGHT} #{file} -o #{outfile} -quiet"

				remFiles.push(file)

			else
				cmds.push "convert -strip -interlace Plane -gaussian-blur 0.05 -quality 85% #{file} -resize #{arg.resize}% #{file}"
	

	num_cmds = cmds.length
	progress = 0

	run = (cmds) =>

		if cmds.length is 0
			rm( remFiles )
			pack_images tmp_dir, WIDTH, HEIGHT
			return

		echo "Progress #{progress} / #{num_cmds}"

		cmd = cmds.shift()

		exec cmd, (code, output) ->
			# console.log('Exit code:', code);
			# console.log('Program output:', output);
			progress++
			run cmds

	run cmds

do process_images