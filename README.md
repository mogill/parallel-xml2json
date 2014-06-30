# Parallel XML to JSON Converter

This Javascript module converts 
large XML files to JSON in parallel by extracting 
all the elements with a given tag
and storing them in EMS shared memory with persistent storage.

Additional processing may be done with legacy sequential Node.js scripts,
to which additional [EMS](https://github.com/SyntheticSemantics/ems)-based 
parallelism can be added as needed.


### Why Parallel Processing for XML? 
Processing multi-gigabyte XML files suffers the dual challenges
 of slow serial processing and too large a memory footprint
 for garbage collected languages.
[EMS](https://github.com/SyntheticSemantics/ems) directly addresses both problems
with parallel programming primitives and a unified API for 
synchronizing access to large amounts of shared data.

Shared-nothing parallel programming models like Hadoop are not
applicable to processing a single XML file, and serial execution
under-utilizes expensive disk bandwidth.  This parallel XML
parser benefits from harnessing both the computing capability of multiple
cores and parallelism to mask file system latency.


## Quick Start

This script will download the 
[SwissProt database from the University of Washington](http://www.cs.washington.edu/research/xmldatasets/www/repository.html#pir),
install the required NPM modules (EMS, xml2js, and parallel-xml2json),
copy the included example into the current directory,
and load the XML database using 4 processes.

```
curl http://www.cs.washington.edu/research/xmldatasets/data/SwissProt/SwissProt.xml.gz | gunzip > SwissProt.xml
npm install ems xml2js parallel-xml2json
cp node_modules/parallel-xml2json/example.js ./
node example.js 4 SwissProt.xml Entry 100000
```

All the XML data tagged "Entry" are stored as JSON in EMS memory,
then the program prints some of the contents to the console,
first with a serial loop and then with a parallel loop.


### Performance
Using 16 cores the program sustains throughput of 17-21MB/sec (totalling
about 40MB/sec of I/O including both reading and writing).  This rate
corresponds to approximately 1GB/minute to process XML into usable JSON.
Performance varies with the length and complexity of the XML data.

## What This Package Does

The EMS memory region size is conservatively guesstimated on the XML file size, 
and may be as much as double the size of the XML file.

The following steps are carried out by every process:
 
1. Open the XML file and create the shared EMS memory
1. Read a block of the file at an offset based on the current shared loop index
1. All the matching tags in the block are identified
1. The [xml2js](https://www.npmjs.org/package/xml2js) NPM package parses the XML into JSON
1. The JSON value is stored in the EMS array

When no XML records remain, a join is performed and the original
function call returns.  The program may continue to process data or
immediately exit, in both cases 
the operating system flushes the EMS memory to the file at some later time.


__It is important to node that the converter does not 
maintain document ordering of the XML elements__, 
many users expect the document ordering
although this is not actually required in `XML 1.0`.
To restore original input order it is possible to sort the 
JSON records,
please contact us if you're interested in that capability.


## Single-Function API / Example Program
```
var nProcs = parseInt(process.argv[2]);
var xmlFilename = process.argv[3];
var parXML2json = require('./parXML2json');
var ems = require('ems')(nProcs, false, 'fj');

//  Parse XML file in parallel and return the EMS descriptor
//  other programs use to map this EMS file into memory.
var emsParams = parXML2json.parseAll(
    ems,                                  // Global EMS object
    nProcs,                               // Number of processes
    xmlFilename,                          // XML input Filename
    xmlFilename.replace('.xml', '.ems'),  // EMS output filename
    process.argv[4],             // XML tag to create JSON object for
    process.argv[5],    // Maximum number of XML tag-data objects
    2000000,            // Largest filesystem read operation (in bytes)
    10000);             // Length of longest possible XML tag-data object

// Ordinary sequential loop to skip through some of the JSON records.
// All work is performed using only the master thread.
for(var idx = 0;  idx < emsParams.nRecords;  idx += Math.floor(emsParams.nRecords/3) ) {
    console.log('serial readback: ', idx, XML2jsonEMS.readFF(idx) )
}

//  An EMS fork-join parallel region performs this function
//  once on every EMS worker process
ems.parallel( function() {
    //  Parallel loop, iterations are distributed across tasks.
    //  Static loop scheduling is used only to demonstrate each thread
    //  having one iteration.
    ems.parForEach(0, ems.nThreads, function (idx) {
        console.log('parallel readback', idx, XML2jsonEMS.read(idx));
    });
});

process.exit(0);  // Required to terminate other EMS processes
```

The return value of `parXML2json.parseAll()` is an object:
```
{ 
   readEMSDescr : <object>,  // EMS descriptor used by future programs 
   nRecords : <integer>,     // JSON elements are stored at indexes 0...nRecords-1 
   nBytesParsed : <integer>  // Number of bytes inspected while parsing
}
```

### Global `XML2jsonEMS` Variable 
Upon return, every process has the global variable `XML2jsonEMS` defined with
an EMS object that may be used to access the JSON elements 
(ie: `XML2jsonEMS.read()`).
This is required for per-process data persistence during serial regions,
without which all the required modules would need to be reloaded at each fork.

### Function Parameters
* `ems` - Global EMS object, used to manage parallelism in both the calling program and parse function
* `nProcs` - Number of processes.  The system may be over-subscribed.
* `xmlFilename` - XML input Filename.
* `emsFilename` - EMS output filename.
* `XMLtag` - Only XML records matching this tag are converted to JSON.  This tag may appear at any level of the hierarchy.
* `max # tags` - A conservative estimate of the number of XML records in the file.
* `blockSize` - Decompose the file into blocks of this size (in bytes).  This is the length of each file read operation.
* `blockOverlap` - Because an XML record may span more than one block, blocks must overlap by
the Length of longest possible XML tag-data object.  If underflow occurs, the parser will immediately exit.


## Future Work
* Accept a user defined function that generates an unique key from the XML
  record and storing the key-value pair in EMS. 
* Sort results into original file order.


## License
This software and documentation is made available under the BSD license.
Other commercial and open source licenses are available.
