using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Infrastructure.Database;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261010220000_AddLessonMediaDeletionOutbox")]
public partial class AddLessonMediaDeletionOutbox : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "PendingLessonMediaDeletions",
            columns: table => new
            {
                StorageKey = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                QueuedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                Attempts = table.Column<int>(type: "int", nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_PendingLessonMediaDeletions", x => x.StorageKey));
        migrationBuilder.CreateIndex(
            name: "IX_PendingLessonMediaDeletions_NextAttemptAtUtc",
            table: "PendingLessonMediaDeletions", column: "NextAttemptAtUtc");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "PendingLessonMediaDeletions");
    }
}
