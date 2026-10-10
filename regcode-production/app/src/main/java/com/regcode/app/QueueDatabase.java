package com.regcode.app;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.content.Context;
import com.regcode.collection.QueueStore;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** DELETE日志+FULL同步；成功提示前事务必须提交到设备存储。 */
public final class QueueDatabase implements QueueStore.Sql, AutoCloseable {
    private final SQLiteDatabase db;
    public QueueDatabase(Context context) {
        java.io.File file=context.getDatabasePath("production-outbox.sqlite");
        java.io.File parent=file.getParentFile();
        if(parent==null || (!parent.exists() && !parent.mkdirs()))throw new IllegalStateException("无法创建本机扫码数据库目录");
        db=SQLiteDatabase.openOrCreateDatabase(file,null);
        // journal_mode返回结果行；Android的execSQL只接受不返回行的语句。
        try (SQLiteStatement statement=db.compileStatement("PRAGMA journal_mode=DELETE")) {
            if(!"delete".equalsIgnoreCase(statement.simpleQueryForString()))throw new IllegalStateException("本机扫码数据库日志模式未生效");
        }
        db.execSQL("PRAGMA synchronous=FULL");
        try (SQLiteStatement statement=db.compileStatement("PRAGMA synchronous")) {
            if(statement.simpleQueryForLong()!=2)throw new IllegalStateException("本机扫码数据库持久同步模式未生效");
        }
    }
    @Override public void exec(String sql,Object... args) { if(args.length==0)db.execSQL(sql);else db.execSQL(sql,args); }
    @Override public List<JSONObject> rows(String sql,Object... args) throws Exception {
        String[] bind=new String[args.length];for(int i=0;i<args.length;i++)bind[i]=String.valueOf(args[i]);
        List<JSONObject> result=new ArrayList<>();
        try(Cursor cursor=db.rawQuery(sql,bind)) {
            while(cursor.moveToNext()) {
                JSONObject row=new JSONObject();
                for(int i=0;i<cursor.getColumnCount();i++)row.put(cursor.getColumnName(i),cursor.isNull(i)?JSONObject.NULL:cursor.getType(i)==Cursor.FIELD_TYPE_INTEGER?cursor.getLong(i):cursor.getString(i));
                result.add(row);
            }
        }return result;
    }
    @Override public <T> T transaction(QueueStore.Work<T> work) throws Exception {
        db.beginTransaction();try{T result=work.run();db.setTransactionSuccessful();return result;}finally{db.endTransaction();}
    }
    @Override public void close(){db.close();}
}
