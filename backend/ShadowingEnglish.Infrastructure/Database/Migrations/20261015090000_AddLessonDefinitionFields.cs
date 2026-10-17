using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Infrastructure.Database;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261015090000_AddLessonDefinitionFields")]
public partial class AddLessonDefinitionFields : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("LessonType", "LessonVersions", type: "nvarchar(16)", maxLength: 16,
            nullable: false, defaultValue: "clip");
        migrationBuilder.AddColumn<string>("Level", "LessonVersions", type: "nvarchar(2)", maxLength: 2,
            nullable: false, defaultValue: "B1");
        migrationBuilder.AddColumn<string>("Goal", "LessonVersions", type: "nvarchar(500)", maxLength: 500,
            nullable: false, defaultValue: "");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn("LessonType", "LessonVersions");
        migrationBuilder.DropColumn("Level", "LessonVersions");
        migrationBuilder.DropColumn("Goal", "LessonVersions");
    }
}
