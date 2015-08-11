#!/usr/bin/env python

import os, sys, getopt
import re
import json
from optparse import OptionParser
import struct
import imghdr

parser = OptionParser()

parser.add_option("-s", "--src", dest="source", help="Source directory of images")
parser.add_option("-o", "--out", dest="output", help="Output directory of magipack")
parser.add_option("-x", "--width", dest="width", help="Width of image")
parser.add_option("-y", "--height", dest="height", help="Height of image")
parser.add_option("-i", "--imagesperpack", dest="imagesperpack", help="Amount of images per pack")
parser.add_option("-d", "--duration", dest="duration", help="Duration of video")

(options, args) = parser.parse_args()

def listFiles(path):
	if not path.endswith('/'): path += '/'
	
	files = os.listdir(path)
	num_files = len(files)
	arr = []

	# fix for file order
	for i in range(num_files):

		f = files[i]

		if f.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):

			fileType = f.split('.')[1]

			file_name = "%s.%s" % ((i + 1), fileType)
			arr.append([path + file_name, file_name])

	return arr

def packImages(file_prefix, files):

	output = None
	data = []
	p = 0
	c = 0
	for fn in files:
		f = open(fn[0], 'r').read()
		l = len(f)
		if output == None: output = f
		else: output = output + f
		data.append([fn[1], p, p + l, fn[1][-3:]])
		p += l
		c += 1

	if not os.path.exists(options.output):
		os.makedirs(options.output)

	open(options.output + '/' + file_prefix + '.pack', 'w').write(output)

	return data

def main(argv = None):

	# print(options.source)
	# print(options.imagesperpack)

	files       = listFiles(options.source)
	num_files   = len(files)
	total_packs = int(round(float(num_files) / float(options.imagesperpack)))

	packs       = [None] * total_packs
	pack_index  = 0
	count       = 0

	# print('num_files', num_files)
	# print('total_packs', total_packs)

	# sys.exit('-----------------------')

	for i in range(num_files):

		if count is 0:
			packs[ pack_index ] = []

		packs[ pack_index ].append( files[i] )

		if count >= int(options.imagesperpack):
			count = 0
			pack_index += 1
		else:
			count += 1


	# for index, pack in enumerate(packs):

	# 	print(pack)
	# 	print('-----------------------')
	# sys.exit('-----------------------')

	# Use 1 json for data
	data = dict(
		total_frames   = num_files
		,width   	   = options.width
		,height  	   = options.height
		,imagesperpack = options.imagesperpack
		,duration 	   = int(options.duration)
	)
	data['frames'] = [None] * len(packs)

	# print(packs)

	# sys.exit('-----------------------')

	count = 0

	for i, files in enumerate(packs):
		if files is not None:
			count += 1
			data['frames'][i] = packImages("%s" % i, files)

	data['total_packs'] = count

	open(options.output + '/vimage.json', 'w').write(json.dumps(data))

	print('done')


if __name__ == "__main__":
	try:
		main()
	except Exception, e:
		print e
		pass
