setup:
	npm install
	cd examples && bower install

watch:
	@gulp

release:
	NODE_ENV=production gulp build


## For generating vimages 

frames:
	shjs frames.coffee -f 20 -d 20 -i ./videos/redbull-720.mp4 -o ./videos/frames/redbull

sequence:
	# shjs pack.coffee -s 'videos/frames/redbull' -o 'examples/videos/redbull/hd/jpg' -f 60 -r 80 -t 'hd' -d 20 -w '1280' -h '640'
	# shjs pack.coffee -s 'videos/frames/redbull' -o 'examples/videos/redbull/hd/webp' -f 60 -r 80 -t 'hd' -d 20 -w '1280' -h '640' -e webp

	# shjs pack.coffee -s 'videos/frames/romania' -o 'examples/videos/romania/hd/jpg' -f 60 -r 80 -t 'hd' -d 20 -w '1280' -h '720'
	shjs pack.coffee -s 'videos/frames/romania' -o 'examples/videos/romania/hd/webp' -f 60 -r 80 -t 'hd' -d 20 -w '1280' -h '720' -e webp